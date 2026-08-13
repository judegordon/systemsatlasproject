import { request, onSubmit, say, setCsrfToken, show, hide } from './api.js';

const loading = document.getElementById('loading');
const noNode = document.getElementById('no-node');
const threadWrap = document.getElementById('thread-wrap');
const thread = document.getElementById('thread');
const threadEmpty = document.getElementById('thread-empty');
const signedOut = document.getElementById('signed-out');
const signedIn = document.getElementById('signed-in');
const unverified = document.getElementById('unverified-note');

const form = document.getElementById('comment-form');
const message = document.getElementById('form-message');
const titleField = document.getElementById('title');
const bodyField = document.getElementById('body');
const evidenceField = document.getElementById('evidence');
const nodeInputs = document.getElementById('node-inputs');
const addNode = document.getElementById('add-node');
const replyingTo = document.getElementById('replying-to');
const cancelReply = document.getElementById('cancel-reply');

const PART_LABEL = {
    node: 'the node in general',
    definition: 'definition',
    inclusion: 'inclusion',
    exclusion: 'exclusion',
    sources: 'sources',
    boundary_cases: 'boundary cases',
    uncertainty: 'uncertainty',
    children: 'children / division',
};

const params = new URLSearchParams(window.location.search);
const nodePath = params.get('node') || '';
const NODES_MAX = 4;

let formToken = null;
let parentId = null;

// As on the queue page: every node is built and its text set with textContent.
// Comments are written by whoever posted them.
function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
}

// The node multiselect --------------------------------------------------------
//
// A list of path inputs against the datalist the build bakes into this page.
// Editable and repeatable; the server checks each path against the manifest.

function addNodeInput(value) {
    if (nodeInputs.children.length >= NODES_MAX) return;
    const row = el('div', 'node-input');
    const input = el('input', 'form__input');
    input.type = 'text';
    input.name = 'nodePaths';
    input.setAttribute('list', 'node-paths');
    input.value = value || '';
    row.append(input);

    if (nodeInputs.children.length > 0) {
        const remove = el('button', 'form__button form__button--quiet', 'Remove');
        remove.type = 'button';
        remove.addEventListener('click', () => row.remove());
        row.append(remove);
    }
    nodeInputs.append(row);
}

function selectedNodes() {
    return [...nodeInputs.querySelectorAll('input')]
        .map((i) => i.value.trim())
        .filter((v, i, all) => v !== '' && all.indexOf(v) === i);
}

addNode.addEventListener('click', () => addNodeInput(''));

// Parts -----------------------------------------------------------------------

function partBoxes() {
    return [...form.querySelectorAll('input[name="parts"]')];
}

function selectedParts() {
    return partBoxes().filter((b) => b.checked).map((b) => b.value);
}

function setParts(parts) {
    for (const box of partBoxes()) box.checked = parts.includes(box.value);
}

// Load ------------------------------------------------------------------------

(async () => {
    if (!nodePath) {
        hide(loading);
        show(noNode);
        return;
    }

    document.getElementById('node-label').textContent = nodePath;
    const link = document.getElementById('node-link');
    link.href = `/atlas/${nodePath}/`;
    link.textContent = `Read ${nodePath} →`;

    // Prefill: every ?node= names a node, every ?part= a part. Opened from a
    // section marker both are set; opened from the general link the part
    // defaults to the node itself.
    for (const p of params.getAll('node')) addNodeInput(p);
    if (!nodeInputs.children.length) addNodeInput('');

    const parts = params.getAll('part').filter((p) => p in PART_LABEL);
    setParts(parts.length ? parts : ['node']);

    await loadThread();

    hide(loading);
    show(threadWrap);

    const me = await request('GET', '/me');
    if (!me.ok) {
        show(signedOut);
        setCsrfToken(null);
        return;
    }
    setCsrfToken(me.data.csrfToken);
    show(signedIn);

    if (me.data.account && !me.data.account.verified) {
        show(unverified);
        for (const field of form.elements) field.disabled = true;
    }

    const issued = await request('GET', '/comments/new');
    if (issued.ok) formToken = issued.data.formToken;
})();

// The thread ------------------------------------------------------------------
//
// Published comments only — the endpoint returns nothing else. Threaded one
// level: every reply hangs off a top-level comment, and the shape of the data
// cannot go deeper because the database will not let it.
async function loadThread() {
    const { ok, data } = await request('GET', '/comments');
    thread.replaceChildren();
    if (!ok) return;

    const mine = data.comments.filter((c) => c.nodePath === nodePath);
    const tops = mine.filter((c) => c.parentId === null);
    const repliesTo = new Map();
    for (const c of mine) {
        if (c.parentId === null) continue;
        if (!repliesTo.has(c.parentId)) repliesTo.set(c.parentId, []);
        repliesTo.get(c.parentId).push(c);
    }

    if (!tops.length) {
        show(threadEmpty);
        return;
    }
    hide(threadEmpty);

    for (const top of tops) {
        const block = el('article', 'comment');
        block.append(meta(top));
        if (top.title) block.append(el('p', 'comment__title', top.title));
        block.append(el('p', 'comment__body', top.body));
        if (top.evidence) block.append(el('p', 'comment__evidence', `Evidence: ${top.evidence}`));

        const reply = el('button', 'comment__reply', 'Reply');
        reply.type = 'button';
        reply.addEventListener('click', () => startReply(top));
        block.append(reply);

        for (const child of repliesTo.get(top.id) || []) {
            const sub = el('article', 'comment comment--reply');
            sub.append(meta(child));
            if (child.title) sub.append(el('p', 'comment__title', child.title));
            sub.append(el('p', 'comment__body', child.body));
            if (child.evidence) sub.append(el('p', 'comment__evidence', `Evidence: ${child.evidence}`));
            block.append(sub);
        }

        thread.append(block);
    }
}

function meta(comment) {
    const parts = (comment.parts || ['node']).map((p) => PART_LABEL[p] || p).join(', ');
    return el('p', 'comment__meta',
        `${comment.author} · ${String(comment.createdAt).slice(0, 10)} · on ${parts}`);
}

// A reply answers one comment on one node's thread, about the same parts, so
// the node and part selectors lock while a reply is being written.
function startReply(top) {
    parentId = top.id;
    replyingTo.textContent =
        `Replying to ${top.author}: “${(top.title || top.body).slice(0, 90)}”`;
    nodeInputs.replaceChildren();
    addNodeInput(nodePath);
    setParts(top.parts || ['node']);
    setTargetsDisabled(true);
    show(replyingTo);
    show(cancelReply);
    titleField.focus();
}

function setTargetsDisabled(disabled) {
    for (const input of nodeInputs.querySelectorAll('input, button')) input.disabled = disabled;
    for (const box of partBoxes()) box.disabled = disabled;
    addNode.disabled = disabled;
}

cancelReply.addEventListener('click', () => {
    parentId = null;
    setTargetsDisabled(false);
    hide(replyingTo);
    hide(cancelReply);
});

// Count -----------------------------------------------------------------------

const count = document.getElementById('body-count');
function paintCount() {
    const used = bodyField.value.trim().length;
    count.textContent = `${used} / 2000`;
    count.className = 'form__count' + (used > 2000 ? ' form__count--over' : '');
}
bodyField.addEventListener('input', paintCount);
paintCount();

// Post ------------------------------------------------------------------------

onSubmit(form, message, async (data) => {
    if (!formToken) {
        say(message, 'This form did not finish loading. Reload the page.', 'error');
        return;
    }

    const nodePaths = parentId ? [nodePath] : selectedNodes();
    if (!nodePaths.length) {
        say(message, 'Name at least one node.', 'error');
        return;
    }
    const parts = selectedParts();
    if (!parts.length) {
        say(message, 'Pick at least one part — "the node in general" if none fits.', 'error');
        return;
    }

    const { ok, status, data: body } = await request('POST', '/comments', {
        nodePaths,
        parts,
        parentId,
        title: data.get('title'),
        body: data.get('body'),
        evidence: data.get('evidence'),
        displayAs: data.get('displayAs'),
        formToken,
        website: data.get('website'),
    });

    if (!ok) {
        say(message, body.error || 'Could not post the comment.', 'error');
        if (status === 400) {
            const again = await request('GET', '/comments/new');
            if (again.ok) formToken = again.data.formToken;
        }
        return;
    }

    form.reset();
    paintCount();
    parentId = null;
    setTargetsDisabled(false);
    nodeInputs.replaceChildren();
    addNodeInput(nodePath);
    setParts(['node']);
    hide(replyingTo);
    hide(cancelReply);
    say(message, body.message || 'Posted.', 'ok');

    const next = await request('GET', '/comments/new');
    formToken = next.ok ? next.data.formToken : null;
});
