
const Events = require("../index");

describe("issue/pr events", () => {
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

    function defineTests(pretext) {
        it("fills default info for any action", () => {
            const event = Events.create("FAKE", data);

            expect(event.repo).toEqual(data.repository);
            expect(event.info).toEqual(info);
            expect(event.action).toEqual("FAKE");
            expect(event.data).toEqual(data);
            expect(event.repoId).toEqual(data.repository.full_name.toLowerCase());

            expect(event.id).toEqual(`${event.repoId}#${info.number}`);
            expect(event.sender).toEqual("SENDER");
            expect(event.participants).toEqual(["OWNER", "USER", "SENDER"]);
            expect(event.mentions).toEqual([]);
        });

        it("ignores unknown actions", () => {
            const event = Events.create("FAKE", data);

            expect(event.assignee).toBeUndefined();
            expect(event.comment).toBeUndefined();
            expect(event.details).toBeUndefined();
        });

        it("handles 'opened'", () => {
            const event = Events.create("opened", data);

            expect(event.assignee).toBeUndefined();
            expect(event.comment).toBeUndefined();
            expect(event.participants).toEqual(["OWNER", "USER", "SENDER"]);
            expect(event.mentions).toEqual(["TITLE_MENTION", "BODY_MENTION1", "BODY_MENTION2"]);

            verifyDetails(event, pretext, "Opened by SENDER", info.body);
        });

        it("handles 'reopened'", () => {
            const event = Events.create("reopened", data);

            expect(event.assignee).toBeUndefined();
            expect(event.comment).toBeUndefined();
            expect(event.participants).toEqual(["OWNER", "USER", "SENDER"]);
            expect(event.mentions).toEqual([]);

            verifyDetails(event, pretext, "Reopened by SENDER");
        });

        it("handles 'assigned'", () => {
            data.assignee = {
                login: "ASSIGNEE",
            };

            const event = Events.create("assigned", data);

            expect(event.assignee).toEqual("ASSIGNEE");
            expect(event.comment).toBeUndefined();
            expect(event.participants).toEqual(["OWNER", "USER", "SENDER", "ASSIGNEE"]);
            expect(event.mentions).toEqual([]);

            verifyDetails(event, pretext, "Assigned to ASSIGNEE by SENDER");
        });

        it("handles 'unassigned'", () => {
            data.assignee = {
                login: "ASSIGNEE",
            };

            const event = Events.create("unassigned", data);

            expect(event.assignee).toEqual("ASSIGNEE");
            expect(event.comment).toBeUndefined();
            expect(event.participants).toEqual(["OWNER", "USER", "SENDER", "ASSIGNEE"]);
            expect(event.mentions).toEqual([]);

            verifyDetails(event, pretext, "Unassigned from ASSIGNEE by SENDER");
        });

        it("handles 'commented'", () => {
            data.comment = {
                body:     "+1!!! @COMMENT_MENTION1 heyo @COMMENT_MENTION2 wut @USER",
                html_url: "http://comment",
            };

            const event = Events.create("commented", data);

            expect(event.assignee).toBeUndefined();
            expect(event.comment).toEqual(data.comment);
            expect(event.participants).toEqual(["OWNER", "USER", "SENDER"]);
            expect(event.mentions).toEqual(["COMMENT_MENTION1", "COMMENT_MENTION2"]);

            verifyDetails(event, pretext, "Comment by SENDER", data.comment.body, "http://comment");
        });

        it("handles 'closed'", () => {
            const event = Events.create("closed", data);

            expect(event.assignee).toBeUndefined();
            expect(event.comment).toBeUndefined();
            expect(event.participants).toEqual(["OWNER", "USER", "SENDER"]);
            expect(event.mentions).toEqual([]);

            verifyDetails(event, pretext, "Closed by SENDER");
        });
    }

    describe("issues", () => {
        beforeEach(() => {
            data.issue = info;
        });

        afterEach(() => {
            delete data.issue;
        });

        defineTests("[<http://repo|FOO/BAR>] Issue <http://info|#37: baz @TITLE_MENTION>");
    });

    describe("pull requests", () => {
        const pretext = "[<http://repo|FOO/BAR>] Pull Request <http://info|#37: baz @TITLE_MENTION>";

        beforeEach(() => {
            data.pull_request = info;
        });

        afterEach(() => {
            delete data.pull_request;
        });

        defineTests(pretext);

        it("handles 'synchronize'", () => {
            const event = Events.create("synchronize", data);

            expect(event.assignee).toBeUndefined();
            expect(event.comment).toBeUndefined();
            expect(event.participants).toEqual(["OWNER", "USER", "SENDER"]);
            expect(event.mentions).toEqual([]);

            verifyDetails(event, pretext, "Commits added by SENDER");
        });

        it("handles 'merged'", () => {
            info.merged = true;
            const event = Events.create("closed", data);

            expect(event.assignee).toBeUndefined();
            expect(event.comment).toBeUndefined();
            expect(event.participants).toEqual(["OWNER", "USER", "SENDER"]);
            expect(event.mentions).toEqual([]);

            verifyDetails(event, pretext, "Merged by SENDER");
        });
    });
});
