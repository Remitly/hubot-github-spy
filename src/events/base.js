
module.exports = class BaseEvent {
    constructor(data) {
        this.data    = data;
        this.action  = data.action;
        this.repo    = data.repository;
        this.comment = data.comment;

        this.repoId       = this.repo.full_name.toLowerCase();
        this.id           = this.buildId();
        this.sender       = this.data.sender.login;
        this.participants = new Set([this.repo.owner.login, this.sender]);
        this.mentions     = new Set();

        this.buildDetails();
    }

    //
    // Protected
    //

    // Helpers

    buildCommentDetails() {
        let title = "Comment";
        switch (this.action) {
        case "edited":
            title += " edited";
            break;

        case "deleted":
            title += " deleted";
            break;

        default:
            break;
        }

        this.participants.add(this.comment.user.login);
        this.addMentions(this.comment.body);
        this.setDetails({
            title:      `${title} by ${this.sender}`,
            title_link: this.comment.html_url,
            text:       this.comment.body,
        });
    }

    addMentions(...sources) {
        const re = /@([\w-]+)/g;

        for (const source of sources) {
            let match;
            while ((match = re.exec(source))) {
                const login = match[1];

                if (!this.participants.has(login)) {
                    this.mentions.add(login);
                }
            }
        }
    }

    setDetails(details) {
        details.pretext  = this.pretext();
        details.fallback = `${details.pretext}\n> ${details.title}`;

        if (details.text) {
            details.fallback += `\n> ${details.text}`;
        }

        this.details = details;
    }

    /* abstract buildId() */
    /* abstract pretext() */
};
