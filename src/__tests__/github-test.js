/* eslint-disable
    camelcase,
    global-require,
    no-param-reassign,
    no-shadow,
*/

jest.mock("ioredis");
jest.mock("../events");

const Redis = require("ioredis");
const Events = require("../events");
const Github = require("../github");

Events.create.mockImplementation((action, data) => data);

describe("github", () => {
    let robot;
    let redis;

    const userForId = jest.fn(userId => ({
        id:   userId,
        name: userId.replace("ID_", ""),
    }));

    beforeEach(() => {
        jest.clearAllMocks();

        robot = {
            adapter: {
                client: {
                    rtm: {
                        dataStore: {
                            getUserById: userForId,
                        },
                    },
                },
            },
            brain: {
                userForId,
            },
            logger: {
                info: jest.fn(),
            },
            messageRoom: jest.fn(),
        };
        redis = new Redis();
    });

    afterEach(() => {
        robot = null;
        redis = null;
    });

    function create() {
        return new Github(robot, redis);
    }

    const userId = "USER_ID";
    const user = {
        id: userId,
    };

    describe("logins", () => {
        const alias = "ALIAS";

        it("sets login", () => {
            const github = create();
            github.setLoginForUser(user, alias);

            expect(redis.defineCommand).toBeCalledWith("setLoginForUser", jasmine.any(Object));
            expect(redis.setLoginForUser).toBeCalledWith(userId, alias);
        });

        it("gets login", () => {
            const github = create();
            const reply  = jest.fn();

            github.loginForUser(user, reply);
            expect(redis.hget).toBeCalledWith("users", userId, jasmine.any(Function));

            const cb = redis.hget.mock.calls[0][2];

            cb(null, null);
            expect(reply).lastCalledWith(null);

            cb(null, alias);
            expect(reply).lastCalledWith(alias);
        });

        it("clears login", () => {
            const github = create();
            github.setLoginForUser(user);

            expect(redis.defineCommand).toBeCalledWith("setLoginForUser", jasmine.any(Object));
            expect(redis.setLoginForUser).lastCalledWith(userId, undefined);
        });
    });

    describe("watches", () => {
        function defineTests(type) {
            function capitalize(str) {
                return str.charAt(0).toUpperCase() + str.slice(1);
            }

            it(`adds ${type} watches`, () => {
                const github = create();
                let result;

                redis.exec.mockReturnValue(true);
                result = github[`addWatcherFor${capitalize(type)}`](user, "FOO/BAR");
                expect(result).toEqual(true);

                redis.exec.mockReturnValue(false);
                result = github[`addWatcherFor${capitalize(type)}`](user, "FOO/BAR");
                expect(result).toEqual(false);

                expect(redis.multi).toBeCalled();
                expect(redis.sadd).toBeCalledWith(`${type}:foo/bar`, userId);
                expect(redis.sadd).toBeCalledWith(`user:${userId}:${type}`, "foo/bar");
                expect(redis.exec).toBeCalled();
            });

            it(`gets ${type} watches`, () => {
                const github = create();
                const reply  = jest.fn();

                github[`${type}sForUser`](user, reply);
                expect(redis.smembers).toBeCalledWith(`user:${userId}:${type}`, jasmine.any(Function));

                const cb = redis.smembers.mock.calls[0][1];
                let items;

                items = [];
                cb(null, items);
                expect(reply).lastCalledWith(items);

                items = ["FOO/BAR", "BAZ/FOO"];
                cb(null, items);
                expect(reply).lastCalledWith(items);
            });

            it(`removes ${type} watches`, () => {
                const github = create();
                let result;

                redis.exec.mockReturnValue(true);
                result = github[`removeWatcherFor${capitalize(type)}`](user, "FOO/BAR");
                expect(result).toEqual(true);

                redis.exec.mockReturnValue(false);
                result = github[`removeWatcherFor${capitalize(type)}`](user, "FOO/BAR");
                expect(result).toEqual(false);

                expect(redis.multi).toBeCalled();
                expect(redis.srem).toBeCalledWith(`${type}:foo/bar`, userId);
                expect(redis.srem).toBeCalledWith(`user:${userId}:${type}`, "foo/bar");
                expect(redis.exec).toBeCalled();
            });
        }

        describe("repos", () => {
            defineTests("repo");
        });

        describe("issues", () => {
            defineTests("issue");
        });
    });

    describe("events", () => {
        const action   = "FOO!";
        const eventId  = "FOO_ID";
        const repoId   = "REPO_ID";
        const senderId = "SENDER_ID";

        const participantsKey = `participants:${eventId}`;
        const issueKey        = `issue:${eventId}`;
        const repoKey         = `repo:${repoId}`;

        let data;

        beforeEach(() => {
            data = {
                id:     eventId,
                repoId,
                sender: senderId,
                action,

                participants: new Set(["FOO_USER", "BAR_USER"]),
                mentions:     new Set(["MENTIONED_USER"]),

                commits: [
                    {
                        id:     `${repoId}/1234567890`,
                        author: "COMMITTER1",
                        title:  "commit 1",
                    },
                    {
                        id:     `${repoId}/2345678901`,
                        author: "COMMITTER2",
                        title:  "commit 2",
                    },
                ],
            };
        });

        afterEach(() => {
            data = null;
        });

        it("creates the right event", () => {
            const github = create();

            github.handle("push", data);
            expect(Events.create).lastCalledWith("push", data);

            github.handle("commit_comment", data);
            expect(Events.create).lastCalledWith("commit_comment", data);

            github.handle("issues", data);
            expect(Events.create).lastCalledWith("issues", data);

            github.handle("issue_comment", data);
            expect(Events.create).lastCalledWith("issue_comment", data);

            github.handle("pull_request", data);
            expect(Events.create).lastCalledWith("pull_request", data);

            github.handle("pull_request_review", data);
            expect(Events.create).lastCalledWith("pull_request_review", data);

            github.handle("pull_request_review_comment", data);
            expect(Events.create).lastCalledWith("pull_request_review_comment", data);
        });

        it("adds the participants without details", () => {
            const github = create();

            github.handle("issues", data);
            expect(redis.sadd).toBeCalledWith(participantsKey, [...data.participants], [...data.mentions]);
            expect(redis.expire).toBeCalledWith(participantsKey, jasmine.any(Number));
            expect(redis.smembers).not.toBeCalled();
        });

        it("gets the participants with details", () => {
            const github = create();
            data.details = {};

            github.handle("issues", data);
            expect(redis.sadd).toBeCalledWith(participantsKey, [...data.participants], [...data.mentions]);
            expect(redis.expire).toBeCalledWith(participantsKey, jasmine.any(Number));
            expect(redis.sunion).toBeCalledWith([issueKey]);
            expect(redis.smembers).toBeCalledWith(participantsKey);
            expect(redis.exec).toBeCalledWith(jasmine.any(Function));
        });

        it("gets watchers for opened", () => {
            const github = create();

            data.details = {};
            data.action  = "opened";

            github.handle("issues", data);
            expect(redis.sadd).toBeCalledWith(participantsKey, [...data.participants], [...data.mentions]);
            expect(redis.expire).toBeCalledWith(participantsKey, jasmine.any(Number));
            expect(redis.sunion).toBeCalledWith([issueKey, repoKey]);
            expect(redis.smembers).toBeCalledWith(participantsKey);
            expect(redis.exec).toBeCalledWith(jasmine.any(Function));
        });

        it("sets title for push", () => {
            const github = create();
            github.handle("push", data);

            expect(redis.sadd).toBeCalledWith(`participants:${data.commits[0].id}`, data.commits[0].author);
            expect(redis.expire).toBeCalledWith(`participants:${data.commits[0].id}`, jasmine.any(Number));
            expect(redis.set).toBeCalledWith(`title:${data.commits[0].id}`, data.commits[0].title, "EX", jasmine.any(Number));

            expect(redis.sadd).toBeCalledWith(`participants:${data.commits[1].id}`, data.commits[1].author);
            expect(redis.expire).toBeCalledWith(`participants:${data.commits[1].id}`, jasmine.any(Number));
            expect(redis.set).toBeCalledWith(`title:${data.commits[1].id}`, data.commits[1].title, "EX", jasmine.any(Number));

            expect(redis.exec).toBeCalled();
        });

        function verifyNotify(adapterName, payload, type, delay = 0) {
            robot.adapterName = adapterName;

            const github = create();
            github.handle(type, data);

            const watchers     = ["ID_BAZ", "ID_FOO", "ID_BAR"];
            const participants = ["ABC", "XYZ", senderId];

            const fetchCb = redis.exec.mock.calls.pop()[0];
            redis.exec.mockClear();

            fetchCb(null, [[], [], [null, watchers], [null, participants]]);

            if (delay) {
                expect(redis.exec).not.toHaveBeenCalled();

                jest.runTimersToTime(0);
                expect(redis.exec).not.toHaveBeenCalled();

                jest.runTimersToTime(delay - 1);
                expect(redis.exec).not.toHaveBeenCalled();

                jest.runTimersToTime(1);
                expect(redis.exec).toHaveBeenCalled();
            }

            expect(redis.hmget).toBeCalledWith("logins", participants.map(p => p.toLowerCase()));
            expect(redis.hget).toBeCalledWith("logins", senderId.toLowerCase());
            expect(redis.exec).toBeCalledWith(jasmine.any(Function));

            const participantLogins = participants.map(p => `ID_${p}`);
            const senderLogin       = `ID_${senderId}`;

            const notifyCb = redis.exec.mock.calls.pop()[0];
            notifyCb(null, [[null, participantLogins], [null, senderLogin]]);

            participantLogins.concat(watchers)
                .map(login => login.replace("ID_", ""))
                .filter(userName => userName !== senderId)
                .forEach((userName) => {
                    expect(robot.messageRoom).toBeCalledWith(
                        `ID_${userName}`,
                        payload,
                    );
                });
        }

        describe("notifies participants", () => {
            beforeEach(() => {
                data.details = {
                    foo:      "BAR",
                    fallback: "FALLBACK",
                };
            });

            it("via slack", () => {
                verifyNotify("slack", { attachments: [data.details] }, "issues");
            });

            it("via non-slack", () => {
                verifyNotify("FOO", data.details.fallback, "issues");
                verifyNotify("BAR", data.details.fallback, "issues");
            });

            describe("pull_request_review", () => {
                let originalData;

                beforeEach(() => {
                    jest.useFakeTimers();

                    originalData = Object.assign({}, data);
                    data.review = {
                        id: 99,
                    };
                });

                it("comments are delayed", () => {
                    data.isComment = true;
                    verifyNotify("FOO", data.details.fallback, "pull_request_review", 1000);
                });

                it("non-comments are not delayed", () => {
                    verifyNotify("FOO", data.details.fallback, "pull_request_review");
                });

                it("comments are ignored with pull_request_review_comments", () => {
                    data.isComment = true;
                    robot.adapterName = "FOO";

                    const github = create();
                    github.handle("pull_request_review", data);

                    {
                        const fetchCb = redis.exec.mock.calls.pop()[0];
                        redis.exec.mockClear();

                        fetchCb(null, [[], [], [null, []], [null, []]]);
                        expect(redis.exec).not.toHaveBeenCalled();
                    }

                    github.handle("pull_request_review_comment", Object.assign({}, originalData, { comment: { pull_request_review_id: data.review.id } }));

                    {
                        const fetchCb = redis.exec.mock.calls.pop()[0];
                        redis.exec.mockClear();

                        fetchCb(null, [[], [], [null, []], [null, []]]);
                        expect(redis.exec).toHaveBeenCalled();
                    }

                    redis.exec.mockClear();
                    jest.runTimersToTime(1000);
                    expect(redis.exec).not.toHaveBeenCalled();
                });
            });
        });
    });
});
