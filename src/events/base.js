
module.exports = class BaseEvent {
    constructor(repo, info, action, data) {
        this.repo   = repo;
        this.info   = info;
        this.action = action;
        this.data   = data;
        this.repoId = this.repo.full_name.toLowerCase();

        this.id           = this._buildId();
        this.sender       = this.data.sender.login;
        this.participants = this._buildParticipants();
        this.mentions     = [];

        this._buildDetails();
    }

    //
    // Private
    //

    _buildId() {
        return `${this.repoId}#${this.info.number}`;
    }

    _buildParticipants() {
        return [...new Set([this.repo.owner.login, this.info.user.login, this.sender])];
    }

    _buildMentions(...sources) {
        const mentions = new Set();
        const re = /@([\w-]+)/g;

        for (const source of sources) {
            let match;
            while ((match = re.exec(source))) {
                const login = match[1];

                if (!this.participants.includes(login)) {
                    mentions.add(login);
                }
            }
        }

        this.mentions = [...mentions];
    }

    _setDetails(details) {
        details.pretext  = this._pretext();
        details.fallback = `${details.pretext}\n> ${details.title}`;

        if (details.text) {
            details.fallback += `\n> ${details.text}`;
        }

        this.details = details;
    }
};
