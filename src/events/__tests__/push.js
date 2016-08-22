
"use strict";

jest.unmock("../index");
jest.unmock("../base");
jest.unmock("../push");

describe("push events", () => {
    let data;

    beforeEach(() => {
        data = {
            ref: 'refs/head/foo',
            before: 'beforebefore',
            after: 'afterafter',
            compare: 'http://compare',

            commits: [
                {
                    id: "1234567890",
                    message: "commit 1",
                    author: {
                        username: 'USER1',
                    },
                    url: "http://commit1",
                },
                {
                    id: "2345678901",
                    message: "commit 2\n is multiline!",
                    author: {
                        username: 'USER2',
                    },
                    url: "http://commit2",
                },
                {
                    id: "3456789012",
                    message: "commit 3",
                    author: {
                        username: 'USER1',
                    },
                    url: "http://commit3",
                },
            ],

            repository: {
                full_name: "FOO/BAR",
                owner: {
                    login: "OWNER"
                },
                html_url: "http://repo"
            },

            sender: {
                login: "SENDER"
            }
        };
    });

    afterEach(() => {
        data = null;
    });

    function create(action, data) {
        return require("../index").create(action, data);
    }

    it("handles push events", () => {
        const event = create("push", data);

        expect(event.assignee).toBeUndefined();
        expect(event.comment).toBeUndefined();
        expect(event.participants).toEqual(["OWNER", "SENDER"]);
        expect(event.mentions).toEqual([]);

        expect(event.details.pretext).toEqual("[<http://repo|FOO/BAR>] Branch 'foo': <http://compare|3 Commits>")
        expect(event.details.title).toEqual("Pushed by SENDER");
        expect(event.details.title_link).toBeUndefined();
        expect(event.details.text).toEqual([
            "[USER1: <http://commit1|1234567>] commit 1",
            "[USER2: <http://commit2|2345678>] commit 2",
            "[USER1: <http://commit3|3456789>] commit 3",
        ].join('\n'));
        expect(event.details.fallback).toEqual(`${event.details.pretext}\n> ${event.details.title}\n> ${event.details.text}`);

        expect(event.commits[0].id).toEqual('foo/bar/1234567890');
        expect(event.commits[0].author).toEqual('USER1');
        expect(event.commits[0].title).toEqual('commit 1');
        expect(event.commits[0].text).toEqual('[USER1: <http://commit1|1234567>] commit 1');

        expect(event.commits[1].id).toEqual('foo/bar/2345678901');
        expect(event.commits[1].author).toEqual('USER2');
        expect(event.commits[1].title).toEqual('commit 2\n is multiline!');
        expect(event.commits[1].text).toEqual('[USER2: <http://commit2|2345678>] commit 2');

        expect(event.commits[2].id).toEqual('foo/bar/3456789012');
        expect(event.commits[2].author).toEqual('USER1');
        expect(event.commits[2].title).toEqual('commit 3');
        expect(event.commits[2].text).toEqual('[USER1: <http://commit3|3456789>] commit 3');
    });
});
