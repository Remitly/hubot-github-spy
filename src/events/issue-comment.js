
const IssueEvent = require("./issue");

module.exports = class IssueCommentEvent extends IssueEvent {
    // BaseEvent

    buildDetails() {
        this.participants.add(this.info.user.login);
        this.buildCommentDetails();
    }
};
