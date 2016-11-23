
const Events = require("../index");

describe("pull request review", () => {
    const type = "pull_request_review";
    const pretext = "[<http://repo|FOO/BAR>] Pull Request <http://info|#37: baz @TITLE_MENTION>";

    let data;

    beforeEach(() => {
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

            pull_request: {
                number: "37",
                title:  "baz @TITLE_MENTION",
                body:   "+1 @BODY_MENTION1 heyo @BODY_MENTION2 wut @USER",
                user:   {
                    login: "USER",
                },
                html_url: "http://info",
            },

            review: {
                user: {
                    login: "REVIEWER",
                },

                body:     "asdf @REVIEW_MENTION weoi",
                html_url: "http://review",
            },
        };
    });

    function verifyDetails(event, title, text, titleLink) {
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

    function verifyReview(state, title, isComment) {
        data.review.state = state;
        const event = Events.create(type, data);

        expect(event.assignee).toBeUndefined();
        expect(event.comment).toBeUndefined();
        expect(event.review).toBe(data.review);
        expect(event.participants).toEqual(new Set(["OWNER", "SENDER", "USER", "REVIEWER"]));
        expect(event.mentions).toEqual(new Set(["REVIEW_MENTION"]));
        expect(event.isComment).toBe(isComment);

        verifyDetails(event, title, data.review.body, "http://review");
    }

    it("handles all expected states", () => {
        verifyReview(undefined, "Reviewed by SENDER", false);
        verifyReview("commented", "Reviewed by SENDER", true);
        verifyReview("changes_requested", "Changes requested by SENDER", false);
        verifyReview("approved", "Approved by SENDER", false);
    });
});
