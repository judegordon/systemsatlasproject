//
// Comments, from docs/PROPOSALS.md §5. Build step 6.
//
// "Every node carries a thread. One level of replies, no deeper — nested
// argument past that point wants to be a proposal." The depth rule is a
// trigger, not a check in the route, so the tests that matter push at it from
// both sides: through the API, and with a direct INSERT that skips the API
// entirely.
//
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const h = require('./helpers');
const proposals = require('../src/proposals');

before(async () => { await h.start(); });
after(async () => { await h.stop(); });
beforeEach(async () => { await h.reset(); });

const NODE = 'human-biological/nervous-system';
const OTHER = 'legal';

function aComment(over = {}) {
    return {
        nodePath: NODE,
        parts: ['node'],
        title: 'An exclusion pointing nowhere',
        body: 'The exclusion here points at a system that does not exist.',
        evidence: 'human-biological/nervous-system',
        displayAs: 'name',
        formToken: proposals.issueFormToken(Date.now() - 30000),
        website: '',
        ...over,
    };
}

async function contributor(email = 'talker@example.com', displayName = 'A Contributor') {
    const c = h.client();
    await h.signedUp(c, { email, displayName });
    return c;
}

async function admin(email = 'admin@example.com') {
    const c = h.client();
    await h.signedUp(c, { email });
    await h.pool.query('UPDATE atlas.accounts SET is_admin = TRUE WHERE email = $1', [email]);
    return c;
}

// Post and publish. Returns the comment id.
async function published(client, adminClient, over = {}) {
    const r = await client.post('/atlas/comments', aComment(over));
    assert.equal(r.status, 201, `posting was ${r.status}`);
    const d = await adminClient.post(`/atlas/admin/comments/${r.data.comments[0].id}/publish`, {});
    assert.equal(d.status, 200, `publishing was ${d.status}`);
    return r.data.comments[0].id;
}

function anyone() {
    return h.client();
}


describe('posting', () => {
    test('a signed-out caller gets 401', async () => {
        assert.equal((await anyone().post('/atlas/comments', aComment())).status, 401);
    });

    test('a verified account posts, and it starts pending', async () => {
        const c = await contributor();
        const r = await c.post('/atlas/comments', aComment());

        assert.equal(r.status, 201);
        assert.equal(r.data.comments[0].status, 'pending');
        assert.equal(r.data.comments[0].parentId, null);
    });

    test('a comment over 2000 characters is refused, and told it is a proposal', async () => {
        const c = await contributor();
        const r = await c.post('/atlas/comments', aComment({ body: 'x'.repeat(2001) }));
        assert.equal(r.status, 400);
        assert.match(r.data.error, /proposal/i);
    });

    test('a node that is not in the atlas is refused', async () => {
        const c = await contributor();
        const r = await c.post('/atlas/comments', aComment({ nodePath: 'invented/node' }));
        assert.equal(r.status, 400);
    });

    test('an unverified account is refused', async () => {
        const c = h.client();
        await c.post('/atlas/accounts', {
            email: 'unverified@example.com', password: 'correct horse battery',
            displayName: 'Not Yet',
        });
        await c.post('/atlas/sessions', {
            email: 'unverified@example.com', password: 'correct horse battery',
        });
        const r = await c.post('/atlas/comments', aComment());
        assert.equal(r.status, 403);
    });

    test('the honeypot is accepted out loud and stored nowhere', async () => {
        const c = await contributor();
        const r = await c.post('/atlas/comments', aComment({ website: 'http://example.com' }));
        assert.equal(r.status, 202);

        const { rows } = await h.pool.query('SELECT count(*)::int AS n FROM atlas.comments');
        assert.equal(rows[0].n, 0);
    });

    test('the twenty-second rule applies here too', async () => {
        const c = await contributor();
        const r = await c.post('/atlas/comments',
            aComment({ formToken: proposals.issueFormToken(Date.now() - 2000) }));
        assert.equal(r.status, 400);
        assert.match(r.data.error, /moment longer/i);
    });

    test('five a day per account, and the sixth is refused', async () => {
        const c = await contributor();
        for (let i = 0; i < 5; i += 1) {
            const r = await c.post('/atlas/comments', aComment({ body: `Comment ${i}.` }));
            assert.equal(r.status, 201, `comment ${i + 1} was ${r.status}`);
        }
        const sixth = await c.post('/atlas/comments', aComment({ body: 'One too many.' }));
        assert.equal(sixth.status, 429);
    });
});


describe('targets: parts, title, evidence', () => {
    test('a missing title is refused', async () => {
        const c = await contributor();
        const r = await c.post('/atlas/comments', aComment({ title: '' }));
        assert.equal(r.status, 400);
        assert.match(r.data.error, /title/i);
    });

    test('missing evidence is refused', async () => {
        const c = await contributor();
        const r = await c.post('/atlas/comments', aComment({ evidence: '   ' }));
        assert.equal(r.status, 400);
        assert.match(r.data.error, /evidence/i);
    });

    test('evidence that merely repeats the body is refused', async () => {
        const c = await contributor();
        const body = 'The same words twice over.';
        const r = await c.post('/atlas/comments', aComment({ body, evidence: body }));
        assert.equal(r.status, 400);
        assert.match(r.data.error, /outside the comment/i);
    });

    test('no parts, or an unknown part, is refused', async () => {
        const c = await contributor();
        assert.equal((await c.post('/atlas/comments', aComment({ parts: [] }))).status, 400);
        assert.equal((await c.post('/atlas/comments',
            aComment({ parts: ['margins'] }))).status, 400);
        assert.equal((await c.post('/atlas/comments',
            aComment({ parts: ['node', 'node'] }))).status, 400);
    });

    test('a comment can target several parts, and they publish with it', async () => {
        const c = await contributor();
        const a = await admin();
        await published(c, a, { parts: ['definition', 'exclusion'] });

        const r = await anyone().get('/atlas/comments');
        assert.deepEqual(r.data.comments[0].parts, ['definition', 'exclusion']);
        assert.equal(r.data.comments[0].title, 'An exclusion pointing nowhere');
        assert.equal(r.data.comments[0].evidence, 'human-biological/nervous-system');
    });

    test('a comment already in the table without targets publishes as node-general', async () => {
        // Every comment from before 005_comment_targets.sql is exactly this row.
        const c = await contributor();
        const a = await admin();
        const id = await published(c, a);
        await h.pool.query(
            `UPDATE atlas.comments SET parts = DEFAULT, title = NULL, evidence = NULL
              WHERE id = $1`, [id]);

        const r = await anyone().get('/atlas/comments');
        assert.deepEqual(r.data.comments[0].parts, ['node']);
        assert.equal(r.data.comments[0].title, null);
        assert.equal(r.data.comments[0].evidence, null);
    });
});


describe('several nodes at once', () => {
    test('one comment on two nodes writes a row on each thread', async () => {
        const c = await contributor();
        const r = await c.post('/atlas/comments',
            aComment({ nodePath: undefined, nodePaths: [NODE, OTHER] }));

        assert.equal(r.status, 201);
        assert.equal(r.data.comments.length, 2);
        assert.deepEqual(r.data.comments.map((x) => x.nodePath).sort(), [NODE, OTHER].sort());
    });

    test('a bad path anywhere in the list refuses the lot', async () => {
        const c = await contributor();
        const r = await c.post('/atlas/comments',
            aComment({ nodePath: undefined, nodePaths: [NODE, 'invented/node'] }));
        assert.equal(r.status, 400);

        const { rows } = await h.pool.query('SELECT count(*)::int AS n FROM atlas.comments');
        assert.equal(rows[0].n, 0, 'nothing is written when any path fails');
    });

    test('the same node twice, more than four, or none is refused', async () => {
        const c = await contributor();
        assert.equal((await c.post('/atlas/comments',
            aComment({ nodePath: undefined, nodePaths: [NODE, NODE] }))).status, 400);
        assert.equal((await c.post('/atlas/comments',
            aComment({ nodePath: undefined, nodePaths: [] }))).status, 400);
        assert.equal((await c.post('/atlas/comments', aComment({
            nodePath: undefined,
            nodePaths: [NODE, OTHER, 'legal/courts', 'political', 'economic'],
        }))).status, 400);
    });

    test('a reply cannot address several nodes', async () => {
        const c = await contributor();
        const a = await admin();
        const top = await published(c, a);
        const r = await c.post('/atlas/comments', aComment({
            nodePath: undefined, nodePaths: [NODE, OTHER], parentId: top, body: 'Agreed.',
        }));
        assert.equal(r.status, 400);
        assert.match(r.data.error, /one comment on one node/i);
    });

    test('each node written counts against the daily five', async () => {
        const c = await contributor();
        for (let i = 0; i < 2; i += 1) {
            const r = await c.post('/atlas/comments', aComment({
                nodePath: undefined, nodePaths: [NODE, OTHER], body: `Comment ${i}.`,
            }));
            assert.equal(r.status, 201);
        }
        // Four rows written; a two-node comment would be six, and is refused.
        const r = await c.post('/atlas/comments', aComment({
            nodePath: undefined, nodePaths: [NODE, OTHER], body: 'Over the line.',
        }));
        assert.equal(r.status, 429);

        // One more single-node comment still fits.
        const last = await c.post('/atlas/comments', aComment({ body: 'The fifth.' }));
        assert.equal(last.status, 201);
    });
});


describe('one level of replies, no deeper', () => {
    test('a reply to a top-level comment is allowed', async () => {
        const c = await contributor();
        const a = await admin();
        const top = await published(c, a);

        const reply = await c.post('/atlas/comments', aComment({ parentId: top, body: 'Agreed.' }));
        assert.equal(reply.status, 201);
        assert.equal(reply.data.comments[0].parentId, String(top));
    });

    test('a reply to a reply is refused, and told why', async () => {
        const c = await contributor();
        const a = await admin();
        const top = await published(c, a);

        const reply = await c.post('/atlas/comments', aComment({ parentId: top, body: 'Agreed.' }));
        assert.equal(reply.status, 201);

        const deeper = await c.post('/atlas/comments',
            aComment({ parentId: reply.data.comments[0].id, body: 'And further.' }));
        assert.equal(deeper.status, 400);
        assert.match(deeper.data.error, /one level/i);
    });

    test('the database refuses a third level even without the API', async () => {
        const c = await contributor();
        const a = await admin();
        const top = await published(c, a);
        const reply = await c.post('/atlas/comments', aComment({ parentId: top, body: 'Agreed.' }));

        const { rows } = await h.pool.query('SELECT id FROM atlas.accounts LIMIT 1');
        await assert.rejects(
            () => h.pool.query(
                `INSERT INTO atlas.comments (account_id, node_path, parent_id, display_as, body)
                 VALUES ($1, $2, $3, 'name', 'Straight past the route.')`,
                [rows[0].id, NODE, reply.data.comments[0].id]
            ),
            /one level only/
        );
    });

    test('a reply on a different node than its parent is refused', async () => {
        const c = await contributor();
        const a = await admin();
        const top = await published(c, a);

        const r = await c.post('/atlas/comments',
            aComment({ nodePath: OTHER, parentId: top, body: 'Elsewhere.' }));
        assert.equal(r.status, 400);
    });

    test('replying to a comment that is not there is refused', async () => {
        const c = await contributor();
        const r = await c.post('/atlas/comments', aComment({ parentId: '999999' }));
        assert.equal(r.status, 400);
    });
});


describe('the queue', () => {
    test('a pending comment appears, with the account behind it', async () => {
        const c = await contributor('poster@example.com');
        await c.post('/atlas/comments', aComment());

        const a = await admin();
        const r = await a.get('/atlas/admin/queue');
        assert.equal(r.status, 200);
        assert.equal(r.data.comments.length, 1);
        assert.equal(r.data.comments[0].account.email, 'poster@example.com');
        assert.match(r.data.comments[0].submission.body, /does not exist/);
    });

    test('a reply shows what it is answering', async () => {
        const c = await contributor();
        const a = await admin();
        const top = await published(c, a);
        await c.post('/atlas/comments', aComment({ parentId: top, body: 'Agreed.' }));

        const r = await a.get('/atlas/admin/queue');
        const reply = r.data.comments.find((x) => x.parentId !== null);
        assert.ok(reply, 'the reply is not in the queue');
        assert.match(reply.replyingTo, /does not exist/);
    });

    test('the pending count covers proposals and comments together', async () => {
        const c = await contributor();
        await c.post('/atlas/comments', aComment());

        const p = h.client();
        await h.signedUp(p, { email: 'proposer@example.com' });
        await p.post('/atlas/proposals', {
            type: 'break', nodePath: NODE, case: 'A case.',
            body: 'An argument.', sources: [], displayAs: 'name',
            formToken: proposals.issueFormToken(Date.now() - 30000), website: '',
        });

        const a = await admin();
        const r = await a.get('/atlas/admin/queue');
        assert.equal(r.data.pending, 2);
        assert.equal(r.data.items.length, 1);
        assert.equal(r.data.comments.length, 1);
    });

    test('an ordinary account cannot publish a comment', async () => {
        const c = await contributor();
        const r0 = await c.post('/atlas/comments', aComment());
        const meddler = await contributor('meddler@example.com');
        const r = await meddler.post(`/atlas/admin/comments/${r0.data.comments[0].id}/publish`, {});
        assert.equal(r.status, 404);
    });
});


describe('publish and reject', () => {
    test('publishing needs no reason — there is nothing to explain', async () => {
        const c = await contributor();
        const a = await admin();
        const r0 = await c.post('/atlas/comments', aComment());

        const r = await a.post(`/atlas/admin/comments/${r0.data.comments[0].id}/publish`, {});
        assert.equal(r.status, 200);
        assert.equal(r.data.comment.status, 'published');

        const { rows } = await h.pool.query(
            'SELECT status, decision_reason FROM atlas.comments WHERE id = $1',
            [r0.data.comments[0].id]);
        assert.equal(rows[0].status, 'published');
        assert.equal(rows[0].decision_reason, null);
    });

    test('rejecting requires one', async () => {
        const c = await contributor();
        const a = await admin();
        const r0 = await c.post('/atlas/comments', aComment());

        const blank = await a.post(`/atlas/admin/comments/${r0.data.comments[0].id}/reject`, {});
        assert.equal(blank.status, 400);

        const ok = await a.post(`/atlas/admin/comments/${r0.data.comments[0].id}/reject`,
            { reason: 'Restates the node without adding to it.' });
        assert.equal(ok.status, 200);

        const { rows } = await h.pool.query(
            'SELECT status, decision_reason FROM atlas.comments WHERE id = $1',
            [r0.data.comments[0].id]);
        assert.equal(rows[0].status, 'rejected');
        assert.match(rows[0].decision_reason, /Restates the node/);
    });

    test('deciding twice is refused by the database', async () => {
        const c = await contributor();
        const a = await admin();
        const r0 = await c.post('/atlas/comments', aComment());

        await a.post(`/atlas/admin/comments/${r0.data.comments[0].id}/publish`, {});
        const again = await a.post(`/atlas/admin/comments/${r0.data.comments[0].id}/reject`,
            { reason: 'Changed my mind.' });
        assert.equal(again.status, 409);
    });
});


describe('what is published', () => {
    test('a pending comment is not published', async () => {
        const c = await contributor();
        await c.post('/atlas/comments', aComment());

        const r = await anyone().get('/atlas/comments');
        assert.equal(r.status, 200);
        assert.equal(r.data.comments.length, 0);
    });

    test('a published one is, with its author and no session needed', async () => {
        const c = await contributor('named@example.com', 'Jo Bloggs');
        const a = await admin();
        await published(c, a);

        const r = await anyone().get('/atlas/comments');
        assert.equal(r.status, 200);
        assert.equal(r.data.comments.length, 1);
        assert.equal(r.data.comments[0].author, 'Jo Bloggs');
        assert.equal(r.data.comments[0].nodePath, NODE);
    });

    test('an anonymous comment names nobody', async () => {
        const c = await contributor('secret@example.com', 'Should Not Appear');
        const a = await admin();
        await published(c, a, { displayAs: 'anonymous' });

        const r = await anyone().get('/atlas/comments');
        const serialised = JSON.stringify(r.data.comments[0]);
        assert.equal(r.data.comments[0].author, 'Anonymous');
        assert.doesNotMatch(serialised, /secret@example\.com/);
        assert.doesNotMatch(serialised, /Should Not Appear/);
    });

    test('a rejected comment is never published', async () => {
        const c = await contributor();
        const a = await admin();
        const r0 = await c.post('/atlas/comments', aComment());
        await a.post(`/atlas/admin/comments/${r0.data.comments[0].id}/reject`,
            { reason: 'Not an argument.' });

        const r = await anyone().get('/atlas/comments');
        assert.equal(r.data.comments.length, 0);
    });

    test('the shape is the one scripts/build.mjs threads and renders', async () => {
        // Step 7 reads these field names off this endpoint. Renaming one
        // would leave the build writing "undefined" into a node page, and a
        // page that is wrong is worse than a build that failed.
        const c = await contributor('shape@example.com', 'Jo Bloggs');
        const a = await admin();
        await published(c, a);

        const { data } = await anyone().get('/atlas/comments');
        const posted = data.comments[0];

        for (const field of ['id', 'nodePath', 'parentId', 'author', 'body', 'createdAt',
            'parts', 'title', 'evidence']) {
            assert.ok(field in posted, `the build needs ${field}`);
        }
        assert.equal(posted.parentId, null, 'top-level parentId must be null, not absent');
        assert.ok(Date.parse(posted.createdAt), 'createdAt must parse as a date');
    });

    test('a reply carries the id of what it answers, so a thread can be built', async () => {
        const c = await contributor();
        const a = await admin();
        const top = await published(c, a);
        const reply = await c.post('/atlas/comments', aComment({ parentId: top, body: 'Agreed.' }));
        await a.post(`/atlas/admin/comments/${reply.data.comments[0].id}/publish`, {});

        const r = await anyone().get('/atlas/comments');
        const posted = r.data.comments.find((x) => x.parentId !== null);
        assert.equal(posted.parentId, String(top));
    });
});
