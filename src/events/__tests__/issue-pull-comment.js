
const Events = require("../index");

let info;
let data;

beforeEach(() => {
    info = {
        number: "37",
        title:  "baz @TITLE_MENTION",
        body:   "+1 @BODY_MENTION1 heyo @BODY_MENTION2 wut @USER",
        user:   {
            login: "USER",
        },
        html_url: "http://info",
    };

    data = {
        repository: {
            full_name: "FOO/BAR",
            owner:     {
                login: "OWNER",
            },
            html_url: "http://repo",
        },

        sender: {
            login: "SENDER",
        },

        comment: {
            body:     "+1!!! @COMMENT_MENTION1 heyo @COMMENT_MENTION2 wut @USER",
            html_url: "http://comment",

            user: {
                login: "COMMENTER",
            },
        },
    };
});

function verifyDetails(event, pretext, title, text, titleLink) {
    let fallback = `${pretext}\n> ${title}`;

    if (text) {
        fallback += `\n> ${text}`;
    }

    expect(event.details.pretext).toEqual(pretext);
    expect(event.details.title).toEqual(title);
    expect(event.details.fallback).toEqual(fallback);

    if (titleLink) {
        expect(event.details.title_link).toBe(titleLink);
    } else {
        expect(event.details.title_link).toBeUndefined();
    }
}

function defineTests(type, pretext) {
    function verifyComment(action, title) {
        data.action = action;
        const event = Events.create(type, data);

        expect(event.assignee).toBeUndefined();
        expect(event.comment).toEqual(data.comment);
        expect(event.participants).toEqual(new Set(["OWNER", "SENDER", "USER", "COMMENTER"]));
        expect(event.mentions).toEqual(new Set(["COMMENT_MENTION1", "COMMENT_MENTION2"]));

        verifyDetails(event, pretext, title, data.comment.body, "http://comment");
    }

    it("handles the expected actions", () => {
        verifyComment("created", "Comment by SENDER");
        verifyComment("edited", "Comment edited by SENDER");
        verifyComment("deleted", "Comment deleted by SENDER");
    });
}

describe("issue comments", () => {
    const type = "issue_comment";
    const pretext = "[<http://repo|FOO/BAR>] Issue <http://info|#37: baz @TITLE_MENTION>";

    beforeEach(() => {
        data.issue = info;
    });

    defineTests(type, pretext);
});

describe("pull request comments", () => {
    const type = "pull_request_review_comment";
    const pretext = "[<http://repo|FOO/BAR>] Pull Request <http://info|#37: baz @TITLE_MENTION>";

    beforeEach(() => {
        data.pull_request = info;
    });

    defineTests(type, pretext);
});
