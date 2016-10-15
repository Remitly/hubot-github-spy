
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
    };
});

afterEach(() => {
    info = null;
    data = null;
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
    it("handles 'opened'", () => {
        data.action = "opened";
        const event = Events.create(type, data);

        expect(event.assignee).toBeUndefined();
        expect(event.comment).toBeUndefined();
        expect(event.participants).toEqual(new Set(["OWNER", "SENDER", "USER"]));
        expect(event.mentions).toEqual(new Set(["TITLE_MENTION", "BODY_MENTION1", "BODY_MENTION2"]));

        verifyDetails(event, pretext, "Opened by SENDER", info.body);
    });

    it("handles 'reopened'", () => {
        data.action = "reopened";
        const event = Events.create(type, data);

        expect(event.assignee).toBeUndefined();
        expect(event.comment).toBeUndefined();
        expect(event.participants).toEqual(new Set(["OWNER", "SENDER", "USER"]));
        expect(event.mentions).toEqual(new Set([]));

        verifyDetails(event, pretext, "Reopened by SENDER");
    });

    it("handles 'assigned'", () => {
        data.assignee = {
            login: "ASSIGNEE",
        };

        data.action = "assigned";
        const event = Events.create(type, data);

        expect(event.assignee).toEqual("ASSIGNEE");
        expect(event.comment).toBeUndefined();
        expect(event.participants).toEqual(new Set(["OWNER", "SENDER", "USER", "ASSIGNEE"]));
        expect(event.mentions).toEqual(new Set([]));

        verifyDetails(event, pretext, "Assigned to ASSIGNEE by SENDER");
    });

    it("handles 'unassigned'", () => {
        data.assignee = {
            login: "ASSIGNEE",
        };

        data.action = "unassigned";
        const event = Events.create(type, data);

        expect(event.assignee).toEqual("ASSIGNEE");
        expect(event.comment).toBeUndefined();
        expect(event.participants).toEqual(new Set(["OWNER", "SENDER", "USER", "ASSIGNEE"]));
        expect(event.mentions).toEqual(new Set([]));

        verifyDetails(event, pretext, "Unassigned from ASSIGNEE by SENDER");
    });

    it("handles 'closed'", () => {
        data.action = "closed";
        const event = Events.create(type, data);

        expect(event.assignee).toBeUndefined();
        expect(event.comment).toBeUndefined();
        expect(event.participants).toEqual(new Set(["OWNER", "SENDER", "USER"]));
        expect(event.mentions).toEqual(new Set([]));

        verifyDetails(event, pretext, "Closed by SENDER");
    });
}

describe("issues", () => {
    const type = "issues";
    const pretext = "[<http://repo|FOO/BAR>] Issue <http://info|#37: baz @TITLE_MENTION>";

    beforeEach(() => {
        data.issue = info;
    });

    defineTests(type, pretext);
});

describe("pull requests", () => {
    const type = "pull_request";
    const pretext = "[<http://repo|FOO/BAR>] Pull Request <http://info|#37: baz @TITLE_MENTION>";

    beforeEach(() => {
        data.pull_request = info;
    });

    defineTests(type, pretext);

    it("handles 'synchronize'", () => {
        data.action = "synchronize";
        const event = Events.create(type, data);

        expect(event.assignee).toBeUndefined();
        expect(event.comment).toBeUndefined();
        expect(event.participants).toEqual(new Set(["OWNER", "SENDER", "USER"]));
        expect(event.mentions).toEqual(new Set([]));

        verifyDetails(event, pretext, "Commits added by SENDER");
    });

    it("handles 'merged'", () => {
        info.merged = true;
        data.action = "closed";
        const event = Events.create(type, data);

        expect(event.assignee).toBeUndefined();
        expect(event.comment).toBeUndefined();
        expect(event.participants).toEqual(new Set(["OWNER", "SENDER", "USER"]));
        expect(event.mentions).toEqual(new Set([]));

        verifyDetails(event, pretext, "Merged by SENDER");
    });
});
