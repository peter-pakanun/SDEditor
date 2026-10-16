/* Application-authenticated native media. Credentials stay in the cloud client. */
(function (root) {
    'use strict';
    const stale = () => Object.assign(new Error('Private media context changed.'), { stale: true, name: 'AbortError' });
    const mixin = {
        data: () => ({ privateMediaEpoch: 0 }),
        computed: {
            privateMediaAllowed() {
                const user = this.cloudUser, role = user?.role || (user?.isAdmin === true ? 'admin' : undefined);
                const language = this.ctActive ? this.ctWorkspace?.scope?.language : this.lang;
                return !!this.cloudSignedIn && ['admin', 'manager', 'translator'].includes(role)
                    && !!language && (role !== 'translator' || !!user.language && language === user.language);
            },
            privateMediaKey() {
                return JSON.stringify([this.privateMediaEpoch, this.privateMediaAllowed, this.cloudProfileId, this.cloudUser?.id,
                    this.cloudUser?.role, this.cloudUser?.language, this.cloudUser?.assignmentVersion,
                    this.gameVersion, this.branchId, this.ctActive ? this.ctWorkspace?.scope : this.sourceIdentity, this.lang]);
            }
        },
        watch: {
            privateMediaKey: { flush: 'sync', handler() { this._privateMediaLoader?.clear(); this.ctAudioController?.reset(true); } }
        },
        beforeUnmount() { this._privateMediaLoader?.dispose(); this._privateMediaAccess = null; },
        methods: {
            privateMediaRefreshAccess() {
                const auth = this._cloud?.context?.();
                const previous = this._privateMediaAccess;
                if (!previous || !auth || ['epoch', 'profile', 'token', 'role', 'assignedLanguage', 'assignmentVersion', 'allLanguages'].some(key => previous[key] !== auth[key])) {
                    this._privateMediaAccess = auth;
                    this._privateMediaLoader?.clear();
                    this.privateMediaEpoch++;
                }
            },
            privateMediaContext() {
                if (!this.privateMediaAllowed || !this._cloud?.context || !root.PrivateAssets) throw stale();
                const auth = this._cloud.context();
                if (!auth.token || !this._cloud.permissionsCurrent(auth)) throw stale();
                return { key: this.privateMediaKey, client: this._cloud, auth,
                    language: this.ctActive ? this.ctWorkspace.scope.language : this.lang };
            },
            privateMediaCurrent(context) {
                return !!context && this.privateMediaAllowed && context.key === this.privateMediaKey
                    && context.client === this._cloud && this._cloud.permissionsCurrent(context.auth);
            },
            privateMediaRequest(path, options, context) {
                if (!this.privateMediaCurrent(context)) throw stale();
                // These routes return language-neutral bytes/catalog references.
                // The API checks its current stored assignment without a selector;
                // the captured UI language/access key still fences every result.
                // Bearer-only requests also work with the previous CORS contract.
                return context.client.request(path, { ...options, headers: {} }, context.auth);
            },
            privateMediaLoad(path, kind, options = {}) {
                const context = options.context || this.privateMediaContext();
                this._privateMediaLoader ||= root.PrivateAssets.create({
                    request: (path, options, context) => this.privateMediaRequest(path, options, context),
                    current: context => this.privateMediaCurrent(context)
                });
                return this._privateMediaLoader.load(path, { ...options, context, kind });
            },
            async privateMediaJson(path, options = {}) {
                const context = options.context || this.privateMediaContext();
                const result = await this.privateMediaRequest(path, { signal: options.signal }, context);
                if (!this.privateMediaCurrent(context)) throw stale();
                return result;
            }
        }
    };
    root.PrivateMediaUI = { mixin };
})(typeof window !== 'undefined' ? window : globalThis);
