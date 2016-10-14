/* eslint-disable
    global-require,
    no-param-reassign,
    no-shadow,
*/

jest.mock("ioredis");
jest.mock("../github");

const Redis  = require("ioredis");
const Github = require("../github");
const initGithubSpy = require("../github-spy");

describe("hubot github spy", () => {
    let robot;
    let github;

    beforeEach(() => {
        jest.clearAllMocks();

        robot = {
            on:      jest.fn(),
            respond: jest.fn(),

            logger: {
                info:  jest.fn(),
                error: jest.fn(),
            },

            router: {
                post: jest.fn(),
            },
        };

        initGithubSpy(robot);
        github = Github.mock.instances[0];

        robot.respond
            .mock
            .calls
            .forEach((call) => {
                const parts = call[0].toString().split("/");
                parts.shift();
                const modifiers = parts.pop();

                call[0] = new RegExp(`^${parts.join("/")}`, modifiers);
            });
    });

    afterEach(() => {
        robot  = null;
        github = null;
    });

    describe("redis", () => {
        process.env.HUBOT_GITHUB_SPY_REDIS_URL = "redis://gitbot:3737";

        it("is created", () => {
            expect(Redis).toBeCalledWith(process.env.HUBOT_GITHUB_SPY_REDIS_URL);
        });
    });

    function findCall(str) {
        const call = robot
            .respond
            .mock
            .calls
            .find(call => call[0].test(str));

        expect(call).toBeDefined();
        return call;
    }

    function findRegex(str) {
        const regex = findCall(str)[0];
        expect(regex).toBeDefined();
        return regex;
    }

    function findCallback(str) {
        const cb = findCall(str)[1];
        expect(cb).toBeDefined();
        return cb;
    }

    const message = {
        user: {
            id: "fooId",
        },
    };

    describe("logins", () => {
        const alias = "bar";

        it("sets up alias", () => {
            const regex = findRegex("alias foo");

            expect(regex.exec("alias")).toBeFalsy();
            expect(regex.exec("alias?")).toBeFalsy();
            expect(regex.exec("alias ")).toBeFalsy();
            expect(regex.exec("unalias")).toBeFalsy();
            expect(regex.exec(" alias foo")).toBeFalsy();
            expect(regex.exec("alias? foo")).toBeFalsy();
            expect(regex.exec("unalias foo")).toBeFalsy();

            expect(regex.exec("alias foo")).toBeTruthy();
            expect(regex.exec("alias  foo")).toBeTruthy();
            expect(regex.exec("alias foo ")).toBeTruthy();
            expect(regex.exec("ALIAS foo")).toBeTruthy();

            expect(regex.exec("alias foo")[1]).toEqual("foo");
            expect(regex.exec("alias  foo")[1]).toEqual("foo");
            expect(regex.exec("alias foo ")[1]).toEqual("foo");
        });

        it("sets alias", () => {
            const cb    = findCallback("alias foo");
            const reply = jest.fn();

            cb({
                message,
                match: [null, alias],
                reply,
            });

            expect(github.setLoginForUser).lastCalledWith(message.user, alias);
            expect(reply).toBeCalledWith(`Your GitHub alias is set to ${alias}.`);
        });

        it("sets up alias?", () => {
            const regex = findRegex("alias?");

            expect(regex.exec(" alias")).toBeFalsy();
            expect(regex.exec("alias ")).toBeFalsy();
            expect(regex.exec(" alias?")).toBeFalsy();
            expect(regex.exec("alias? ")).toBeFalsy();
            expect(regex.exec("alias foo")).toBeFalsy();

            expect(regex.exec("alias")).toBeTruthy();
            expect(regex.exec("alias?")).toBeTruthy();
            expect(regex.exec("ALIAS")).toBeTruthy();
        });

        it("returns alias", () => {
            const cb    = findCallback("alias?");
            const reply = jest.fn();

            cb({
                message,
                reply,
            });

            expect(github.loginForUser).lastCalledWith(message.user, jasmine.any(Function));
            const logincb = github.loginForUser.mock.calls[0][1];

            logincb(null);
            expect(reply).lastCalledWith("You haven't set a GitHub alias.");

            logincb(alias);
            expect(reply).lastCalledWith(`Your GitHub alias is set to ${alias}.`);
        });

        it("sets up unalias", () => {
            const regex = findRegex("unalias");

            expect(regex.exec("alias")).toBeFalsy();
            expect(regex.exec("alias?")).toBeFalsy();
            expect(regex.exec("alias foo")).toBeFalsy();
            expect(regex.exec(" unalias")).toBeFalsy();

            expect(regex.exec("unalias")).toBeTruthy();
            expect(regex.exec("unalias ")).toBeTruthy();
            expect(regex.exec("UNALIAS")).toBeTruthy();
        });

        it("removes alias", () => {
            const cb    = findCallback("unalias");
            const reply = jest.fn();

            cb({
                message,
                reply,
            });

            expect(github.loginForUser).lastCalledWith(message.user, jasmine.any(Function));
            const logincb = github.loginForUser.mock.calls[0][1];

            logincb(null);
            expect(github.setLoginForUser).not.toBeCalled();
            expect(reply).lastCalledWith("You haven't set a GitHub alias.");

            logincb(alias);
            expect(github.setLoginForUser).lastCalledWith(message.user);
            expect(reply).lastCalledWith("Your GitHub alias has been removed.");
        });
    });

    function capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    function verifyWatch(type, name, reply) {
        const fn = github[`addWatcherFor${capitalize(type)}`];

        expect(fn).lastCalledWith(message.user, name);
        expect(reply).lastCalledWith(`You are now watching the GitHub ${type} ${name}.`);
    }

    function verifyWatching(type, names, reply) {
        const fn = github[`${type}sForUser`];
        expect(fn).lastCalledWith(message.user, jasmine.any(Function));

        const cb = fn.mock.calls[0][1];
        cb(names);

        if (names.length) {
            const formatted = names.sort().map(name => `  - ${name}`).join("\n");
            expect(reply).lastCalledWith(`You are watching the GitHub ${type}s:\n${formatted}`);
        } else {
            expect(reply).lastCalledWith(`You are not watching any GitHub ${type}s.`);
        }
    }

    function verifyUnwatch(type, name, reply) {
        const fn = github[`removeWatcherFor${capitalize(type)}`];

        expect(fn).lastCalledWith(message.user, name);
        expect(reply).lastCalledWith(`You are not watching the GitHub ${type} ${name}.`);
    }

    describe("repos", () => {
        it("sets up watch repo", () => {
            const regex = findRegex("watch foo/bar");

            expect(regex.exec("watch")).toBeFalsy();
            expect(regex.exec("watch?")).toBeFalsy();
            expect(regex.exec("watch ")).toBeFalsy();
            expect(regex.exec("watch foo")).toBeFalsy();
            expect(regex.exec("watch foo/")).toBeFalsy();
            expect(regex.exec("watch /")).toBeFalsy();
            expect(regex.exec("watch / ")).toBeFalsy();
            expect(regex.exec("watch /bar")).toBeFalsy();
            expect(regex.exec("watch /bar ")).toBeFalsy();
            expect(regex.exec("watch  foo/bar")).toBeFalsy();
            expect(regex.exec(" watch foo/bar")).toBeFalsy();

            expect(regex.exec("watch foo/bar")).toBeTruthy();
            expect(regex.exec("watch foo/bar ")).toBeTruthy();
            expect(regex.exec("WATCH foo/bar")).toBeTruthy();

            expect(regex.exec("watch foo/bar")[1]).toEqual("foo/bar");
            expect(regex.exec("watch foo/bar ")[1]).toEqual("foo/bar");
        });

        it("sets watch repo", () => {
            const cb    = findCallback("watch foo/bar");
            const reply = jest.fn();

            const repo = "FOO/BAR";
            cb({
                message,
                match: [null, repo],
                reply,
            });

            verifyWatch("repo", repo, reply);
        });

        it("sets up repos?", () => {
            const regex = findRegex("repos?");

            expect(regex.exec(" repos")).toBeFalsy();
            expect(regex.exec(" repos?")).toBeFalsy();

            expect(regex.exec("repos")).toBeTruthy();
            expect(regex.exec("repos?")).toBeTruthy();
            expect(regex.exec("repos ")).toBeTruthy();
            expect(regex.exec("repos? ")).toBeTruthy();
            expect(regex.exec("REPOS")).toBeTruthy();
        });

        it("returns watch repos", () => {
            const cb    = findCallback("repos?");
            const reply = jest.fn();

            cb({
                message,
                reply,
            });

            verifyWatching("repo", [], reply);
            verifyWatching("repo", ["foo/baz", "foo/bar"], reply);
        });

        it("sets up unwatch repo", () => {
            const regex = findRegex("unwatch foo/bar");

            expect(regex.exec("unwatch")).toBeFalsy();
            expect(regex.exec("unwatch?")).toBeFalsy();
            expect(regex.exec("unwatch ")).toBeFalsy();
            expect(regex.exec("unwatch foo")).toBeFalsy();
            expect(regex.exec("unwatch foo/")).toBeFalsy();
            expect(regex.exec("unwatch /")).toBeFalsy();
            expect(regex.exec("unwatch / ")).toBeFalsy();
            expect(regex.exec("unwatch /bar")).toBeFalsy();
            expect(regex.exec("unwatch /bar ")).toBeFalsy();
            expect(regex.exec("unwatch  foo/bar")).toBeFalsy();
            expect(regex.exec(" unwatch foo/bar")).toBeFalsy();

            expect(regex.exec("unwatch foo/bar")).toBeTruthy();
            expect(regex.exec("unwatch foo/bar ")).toBeTruthy();
            expect(regex.exec("UNWATCH foo/bar")).toBeTruthy();

            expect(regex.exec("unwatch foo/bar")[1]).toEqual("foo/bar");
            expect(regex.exec("unwatch foo/bar ")[1]).toEqual("foo/bar");
        });

        it("removes watch repo", () => {
            const cb    = findCallback("unwatch foo/bar");
            const reply = jest.fn();

            const repo = "FOO/BAR";
            cb({
                message,
                match: [null, repo],
                reply,
            });

            verifyUnwatch("repo", repo, reply);
        });
    });

    describe("issues", () => {
        it("sets up watch issue", () => {
            const regex = findRegex("watch foo/bar#37");

            expect(regex.exec("watch")).toBeFalsy();
            expect(regex.exec("watch?")).toBeFalsy();
            expect(regex.exec("watch ")).toBeFalsy();
            expect(regex.exec("watch foo")).toBeFalsy();
            expect(regex.exec("watch foo/")).toBeFalsy();
            expect(regex.exec("watch /")).toBeFalsy();
            expect(regex.exec("watch / ")).toBeFalsy();
            expect(regex.exec("watch /bar")).toBeFalsy();
            expect(regex.exec("watch /bar ")).toBeFalsy();
            expect(regex.exec("watch  foo/bar")).toBeFalsy();
            expect(regex.exec(" watch foo/bar")).toBeFalsy();
            expect(regex.exec("watch foo/bar")).toBeFalsy();
            expect(regex.exec("watch foo#")).toBeFalsy();
            expect(regex.exec("watch foo/#")).toBeFalsy();
            expect(regex.exec("watch /#")).toBeFalsy();
            expect(regex.exec("watch /# ")).toBeFalsy();
            expect(regex.exec("watch /bar#")).toBeFalsy();
            expect(regex.exec("watch /bar# ")).toBeFalsy();
            expect(regex.exec("watch  foo/bar#")).toBeFalsy();
            expect(regex.exec(" watch foo/bar#")).toBeFalsy();
            expect(regex.exec("watch foo/bar#")).toBeFalsy();
            expect(regex.exec("watch foo#37")).toBeFalsy();
            expect(regex.exec("watch foo/#37")).toBeFalsy();
            expect(regex.exec("watch /#37")).toBeFalsy();
            expect(regex.exec("watch /#37 ")).toBeFalsy();
            expect(regex.exec("watch /bar#37")).toBeFalsy();
            expect(regex.exec("watch /bar#37 ")).toBeFalsy();
            expect(regex.exec("watch  foo/bar#37")).toBeFalsy();
            expect(regex.exec(" watch foo/bar#37")).toBeFalsy();

            expect(regex.exec("watch foo/bar#37")).toBeTruthy();
            expect(regex.exec("watch foo/bar#37 ")).toBeTruthy();
            expect(regex.exec("WATCH foo/bar#37")).toBeTruthy();

            expect(regex.exec("watch foo/bar#37")[1]).toEqual("foo/bar#37");
            expect(regex.exec("watch foo/bar#37 ")[1]).toEqual("foo/bar#37");
        });

        it("sets watch issue", () => {
            const cb    = findCallback("watch foo/bar#37");
            const reply = jest.fn();

            const issue = "FOO/BAR#37";
            cb({
                message,
                match: [null, issue],
                reply,
            });

            verifyWatch("issue", issue, reply);
        });

        it("sets up issues?", () => {
            const regex = findRegex("issues?");

            expect(regex.exec(" issues")).toBeFalsy();
            expect(regex.exec(" issues?")).toBeFalsy();

            expect(regex.exec("issues")).toBeTruthy();
            expect(regex.exec("issues?")).toBeTruthy();
            expect(regex.exec("issues ")).toBeTruthy();
            expect(regex.exec("issues? ")).toBeTruthy();
            expect(regex.exec("ISSUES")).toBeTruthy();
        });

        it("returns watch issues", () => {
            const cb    = findCallback("issues?");
            const reply = jest.fn();

            cb({
                message,
                reply,
            });

            verifyWatching("issue", [], reply);
            verifyWatching("issue", ["FOO/BAZ#12", "FOO/BAR#33"], reply);
        });

        it("sets up unwatch issue", () => {
            const regex = findRegex("unwatch foo/bar#37");

            expect(regex.exec("unwatch")).toBeFalsy();
            expect(regex.exec("unwatch?")).toBeFalsy();
            expect(regex.exec("unwatch ")).toBeFalsy();
            expect(regex.exec("unwatch foo")).toBeFalsy();
            expect(regex.exec("unwatch foo/")).toBeFalsy();
            expect(regex.exec("unwatch /")).toBeFalsy();
            expect(regex.exec("unwatch / ")).toBeFalsy();
            expect(regex.exec("unwatch /bar")).toBeFalsy();
            expect(regex.exec("unwatch /bar ")).toBeFalsy();
            expect(regex.exec("unwatch  foo/bar")).toBeFalsy();
            expect(regex.exec(" unwatch foo/bar")).toBeFalsy();
            expect(regex.exec("unwatch foo/bar")).toBeFalsy();
            expect(regex.exec("unwatch foo#")).toBeFalsy();
            expect(regex.exec("unwatch foo/#")).toBeFalsy();
            expect(regex.exec("unwatch /#")).toBeFalsy();
            expect(regex.exec("unwatch /# ")).toBeFalsy();
            expect(regex.exec("unwatch /bar#")).toBeFalsy();
            expect(regex.exec("unwatch /bar# ")).toBeFalsy();
            expect(regex.exec("unwatch  foo/bar#")).toBeFalsy();
            expect(regex.exec(" unwatch foo/bar#")).toBeFalsy();
            expect(regex.exec("unwatch foo/bar#")).toBeFalsy();
            expect(regex.exec("unwatch foo#37")).toBeFalsy();
            expect(regex.exec("unwatch foo/#37")).toBeFalsy();
            expect(regex.exec("unwatch /#37")).toBeFalsy();
            expect(regex.exec("unwatch /#37 ")).toBeFalsy();
            expect(regex.exec("unwatch /bar#37")).toBeFalsy();
            expect(regex.exec("unwatch /bar#37 ")).toBeFalsy();
            expect(regex.exec("unwatch  foo/bar#37")).toBeFalsy();
            expect(regex.exec(" unwatch foo/bar#37")).toBeFalsy();

            expect(regex.exec("unwatch foo/bar#37")).toBeTruthy();
            expect(regex.exec("unwatch foo/bar#37 ")).toBeTruthy();
            expect(regex.exec("UNWATCH foo/bar#37")).toBeTruthy();

            expect(regex.exec("unwatch foo/bar#37")[1]).toEqual("foo/bar#37");
            expect(regex.exec("unwatch foo/bar#37 ")[1]).toEqual("foo/bar#37");
        });

        it("removes watch issue", () => {
            const cb    = findCallback("unwatch foo/bar#37");
            const reply = jest.fn();

            const issue = "FOO/BAR#37";
            cb({
                message,
                match: [null, issue],
                reply,
            });

            verifyUnwatch("issue", issue, reply);
        });
    });

    describe("incoming", () => {
        const path  = "/github-spy";
        const event = "EVENT";

        const headers = {
            "x-github-event": event,
        };
        const body = {
            foo: "BAR",
        };

        const req = {
            method:      "POST",
            originalUrl: path,

            headers,
            body,
        };

        let res;

        beforeEach(() => {
            res = {
                send: jest.fn(),
            };
        });

        afterEach(() => {
            res = null;
        });

        it("responds at /github-spy", () => {
            expect(robot.router.post).lastCalledWith(path, jasmine.any(Function));

            const cb = robot.router.post.mock.calls[0][1];
            cb(req, res);

            // expect(robot.logger.info).lastCalledWith(`POST ${path}: ${headers} ${body}`);
            expect(res.send).toBeCalledWith("OK");
        });

        it("handles issue", () => {
            expect(robot.router.post).lastCalledWith(path, jasmine.any(Function));

            const cb = robot.router.post.mock.calls[0][1];
            cb(req, res);

            expect(github.handle).lastCalledWith(event, body);
            expect(res.send).toBeCalledWith("OK");
        });
    });
});
