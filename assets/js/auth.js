/* Auth.js - Optimized Supabase Authentication Adapter */

const Auth = {
    currentUser: null,
    profile: null,
    initialized: false,
    _initPromise: null,

    async init() {
        if (this._initPromise) return this._initPromise;

        this._initPromise = (async () => {
            if (!window.SUPABASE_CONFIG) return;

            if (window.RemoteDB && window.RemoteDB.init) {
                await window.RemoteDB.init();
            }

            if (!window.RemoteDB || !window.RemoteDB.client) return;

            // 1. FAST PATH: Load cached profile immediately
            const cached = localStorage.getItem('oasis_profile');
            if (cached) {
                try { this.profile = JSON.parse(cached); } catch (e) { }
            }

            // 2. BACKGROUND PATH: Verify session and sync profile
            const { data: { session } } = await window.RemoteDB.client.auth.getSession();
            if (session?.user) {
                this.currentUser = session.user;
                const freshData = await this.loadProfile(session.user.id);
                if (freshData) {
                    localStorage.setItem('oasis_profile', JSON.stringify(freshData));
                    this.profile = freshData;
                }
            }

            this.checkAccess();

            window.RemoteDB.client.auth.onAuthStateChange(async (event, session) => {
                if (event === 'SIGNED_IN' && session) {
                    this.currentUser = session.user;
                    const fresh = await this.loadProfile(session.user.id);
                    if (fresh) localStorage.setItem('oasis_profile', JSON.stringify(fresh));
                } else if (event === 'SIGNED_OUT') {
                    this.currentUser = null;
                    this.profile = null;
                    localStorage.removeItem('oasis_profile');
                }
            });

            this.initialized = true;
        })();

        return this._initPromise;
    },

    async loadProfile(userId) {
        if (!window.RemoteDB || !window.RemoteDB.client) return null;
        try {
            const { data } = await window.RemoteDB.client
                .from('profiles')
                .select('*')
                .eq('id', userId)
                .single();

            if (data) {
                this.profile = data;
                return data;
            }
        } catch (e) { console.error("Profile sync failed", e); }
        return null;
    },

    async login(identifier, password) {
        if (!window.RemoteDB || !window.RemoteDB.client) {
            return { success: false, message: 'Database connection not initialized' };
        }
        let email = identifier.trim();

        // Optimization: Fetch profile during username lookup to save 1 request
        if (!email.includes('@')) {
            const { data } = await window.RemoteDB.client
                .from('profiles')
                .select('email, role, status, username, full_name, avatar_url')
                .ilike('username', email)
                .single();

            if (data?.email) {
                email = data.email;
                this.profile = data; // Pre-cache profile
            } else {
                return { success: false, message: 'Username not found.' };
            }
        }

        const { data, error } = await window.RemoteDB.client.auth.signInWithPassword({ email, password });

        if (error) return { success: false, message: error.message };

        this.currentUser = data.user;

        // If we don't have the profile yet (email login), fetch it now
        if (!this.profile) {
            const fresh = await this.loadProfile(data.user.id);
            if (fresh) localStorage.setItem('oasis_profile', JSON.stringify(fresh));
        } else {
            localStorage.setItem('oasis_profile', JSON.stringify(this.profile));
        }

        return { success: true, user: data.user };
    },

    async register(userData, secretKey = null) {
        if (!window.RemoteDB || !window.RemoteDB.client) {
            return { success: false, message: 'Offline' };
        }

        const { data, error } = await window.RemoteDB.client.auth.signUp({
            email: userData.email,
            password: userData.password,
            options: {
                data: {
                    username: userData.username,
                    full_name: userData.fullName,
                    avatar_url: userData.avatarUrl || null,
                    role: secretKey === 'OASIS_ADMIN_2026' ? 'admin' : 'community'
                }
            }
        });

        if (error) return { success: false, message: error.message };

        // NOTE: No manual 'insert' here! 
        // Our Database Trigger handles this 10x faster on the server side.
        return { success: true };
    },

    async socialLogin(provider) {
        if (!window.RemoteDB || !window.RemoteDB.client) {
            return { success: false, message: 'Database connection not initialized' };
        }

        try {
            const { data, error } = await window.RemoteDB.client.auth.signInWithOAuth({
                provider: provider, // 'google' or 'facebook'
                options: {
                    redirectTo: window.location.origin + '/index.html'
                }
            });

            if (error) {
                console.error(`[Auth] ${provider} login error:`, error);
                return { success: false, message: error.message };
            }

            // OAuth will redirect the browser — this won't actually return in most cases
            return { success: true, data };
        } catch (err) {
            console.error(`[Auth] ${provider} login exception:`, err);
            return { success: false, message: err.message };
        }
    },

    async logout() {
        localStorage.removeItem('oasis_profile');
        await window.RemoteDB.client.auth.signOut();
        window.location.href = 'index.html';
    },

    getUser() {
        if (!this.currentUser) return null;
        return {
            id: this.profile?.id || this.currentUser.id,
            username: this.profile?.username || this.currentUser.user_metadata?.username,
            role: this.profile?.role || this.currentUser.user_metadata?.role || 'community',
            status: this.profile?.status || 'pending',
            avatar: this.profile?.avatar_url || this.currentUser.user_metadata?.avatar_url || null,
            email: this.profile?.email || this.currentUser.email
        };
    },

    checkAccess() {
        const path = window.location.pathname;
        const user = this.getUser();

        const protectedPages = ['profile.html', 'notifications.html'];
        const adminPages = ['admin/', 'moderation.html', 'dashboard.html', 'content-control.html', 'moderation-queue.html'];

        const isProtected = protectedPages.some(page => path.includes(page));
        const isAdminPage = adminPages.some(page => path.includes(page));

        if ((isProtected || isAdminPage) && !user) {
            console.warn('Unauthorized access. Redirecting to login.');
            window.location.href = '/login.html';
            return;
        }

        if (isAdminPage && user?.role !== 'admin') {
            console.warn('Admin access required. Redirecting to home.');
            window.location.href = '/index.html';
            return;
        }

        if (user && user.status === 'rejected') {
            alert('Your account has been rejected. You will be logged out.');
            this.logout();
        }
    }
};

window.Auth = Auth;
Auth.init().catch(console.error);
