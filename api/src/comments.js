//
// Comments: the bounds, and the one public shape.
//
// docs/PROPOSALS.md §5. "Every node carries a thread. One level of replies, no
// deeper — nested argument past that point wants to be a proposal."
//
// The depth rule is enforced by a trigger in 003_comments.sql rather than here,
// because it has to hold for anything that writes the table. What is here is
// what a person needs told back to them when they get it wrong.
//
// Since 005_comment_targets.sql a comment names the parts of the node it is
// about, carries a title, and cites something. The parts are the sections a
// node page renders, in the order the page renders them — grouping and the
// markers on the node page both read this order.
//
const BODY_MAX = 2000;          // §5
const TITLE_MAX = 200;
const EVIDENCE_MAX = 1000;
const NODES_MAX = 4;            // one comment can address several nodes, not many

const PARTS = [
    'node', 'definition', 'inclusion', 'exclusion',
    'sources', 'boundary_cases', 'uncertainty', 'children',
];
const PART_SET = new Set(PARTS);

function bodyProblem(value) {
    if (typeof value !== 'string' || value.trim() === '') {
        return 'A comment needs something in it.';
    }
    if (value.trim().length > BODY_MAX) {
        return `A comment is limited to ${BODY_MAX} characters. `
             + 'An argument longer than that is a proposal.';
    }
    return null;
}

function titleProblem(value) {
    if (typeof value !== 'string' || value.trim() === '') {
        return 'A comment needs a title.';
    }
    if (value.trim().length > TITLE_MAX) {
        return `A title is limited to ${TITLE_MAX} characters.`;
    }
    return null;
}

// Non-empty and not the body again. Nothing here judges whether the evidence
// is any good — a citation, a URL and an atlas path all pass, because judging
// the source is the reader's job.
function evidenceProblem(value, body) {
    if (typeof value !== 'string' || value.trim() === '') {
        return 'A comment needs evidence — a citation, a URL, or an atlas '
             + 'node path. An internal cross-reference counts.';
    }
    if (value.trim().length > EVIDENCE_MAX) {
        return `Evidence is limited to ${EVIDENCE_MAX} characters.`;
    }
    if (typeof body === 'string' && value.trim() === body.trim()) {
        return 'Evidence has to point somewhere outside the comment, '
             + 'not repeat it.';
    }
    return null;
}

// A non-empty list of known parts, no repeats.
function partsProblem(value) {
    if (!Array.isArray(value) || value.length === 0) {
        return 'A comment names the part of the node it is about — '
             + '"node" if it is about the node in general.';
    }
    if (new Set(value).size !== value.length) {
        return 'Each part once.';
    }
    for (const part of value) {
        if (!PART_SET.has(part)) {
            return `"${String(part)}" is not a part of a node. The parts are: `
                 + `${PARTS.join(', ')}.`;
        }
    }
    return null;
}

function parentProblem(value) {
    if (value === undefined || value === null || value === '') return null;
    if (!/^\d+$/.test(String(value))) return 'That is not a comment to reply to.';
    return null;
}

// The public shape, for the build. Same two rules as a proposal, in the same
// order and for the same reason: anonymous wins over withdrawn, so that
// deleting an account cannot turn an Anonymous comment into a Withdrawn one
// and disclose something to anyone who had read both.
function publicComment(row) {
    let author;
    if (row.display_as === 'anonymous') author = 'Anonymous';
    else if (row.withdrawn_at) author = 'Withdrawn';
    else author = row.display_name;

    return {
        id: String(row.id),
        nodePath: row.node_path,
        parentId: row.parent_id === null ? null : String(row.parent_id),
        author,
        // Comments from before 005 carry no title or evidence and were all
        // about the node in general. The build renders what is here; it does
        // not invent what is not.
        parts: row.parts && row.parts.length ? row.parts : ['node'],
        title: row.title ?? null,
        evidence: row.evidence ?? null,
        body: row.body,
        createdAt: row.created_at,
    };
}

module.exports = {
    BODY_MAX,
    TITLE_MAX,
    EVIDENCE_MAX,
    NODES_MAX,
    PARTS,
    bodyProblem,
    titleProblem,
    evidenceProblem,
    partsProblem,
    parentProblem,
    publicComment,
};
