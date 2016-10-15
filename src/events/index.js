
const CommitCommentEvent = require("./commit-comment");
const IssueCommentEvent = require("./issue-comment");
const IssueEvent = require("./issue");
const PushEvent = require("./push");
const ReviewEvent = require("./review");

module.exports = {
    create(event, data) {
        let Type;

        switch (event) {
        case "push":
            Type = PushEvent;
            break;

        case "commit_comment":
            Type = CommitCommentEvent;
            break;

        case "issues":
        case "pull_request":
            Type = IssueEvent;
            break;

        case "issue_comment":
        case "pull_request_review_comment":
            Type = IssueCommentEvent;
            break;

        case "pull_request_review":
            Type = ReviewEvent;
            break;

        default:
            return null;
        }

        return new Type(data);
    },
};
