/* Community.js - Ported logic for the Social Post Composer and Feed */

const Community = {
    selectedMedia: [],
    maxTextLength: 5000,
    currentPage: 1,
    pageSize: 10,
    currentCategory: 'All Updates',
    currentSearch: '',
    loading: false,
    hasMore: true,

    init() {
        this.textarea = document.getElementById('post-textarea') || document.getElementById('postText');
        this.submitBtn = document.getElementById('submit-post-btn') || document.getElementById('submitPost');
        this.feedContainer = document.getElementById('community-feed') || document.getElementById('feedContainer');
        this.mediaInput = document.getElementById('media-upload');
        this.mediaPreview = document.getElementById('media-preview') || document.getElementById('mediaPreviewContainer');
        this.charCounter = document.getElementById('charCounter');
        this.composer = document.getElementById('postComposer');
        this.avatarImg = document.getElementById('composerAvatar');
        this.usernameSpan = document.getElementById('composerUsername');
        this.emojiPicker = document.getElementById('emojiPicker');
        this.emojiGrid = document.getElementById('emojiGrid');

        if (!this.feedContainer) {
            console.log('[Community] Feed container not found. Skipping initialization.');
            return;
        }

        // Detect if we are on home page (shorter feed)
        this.isHomePage = !!document.getElementById('feedContainer') && !document.getElementById('post-textarea');
        if (this.isHomePage) this.pageSize = 5; // Load fewer on home page


        // 1. FAST PATH: Load cached feed
        const cachedFeed = localStorage.getItem('oasis_community_feed');
        if (cachedFeed) {
            try {
                const posts = JSON.parse(cachedFeed);
                this.feedContainer.innerHTML = posts.map(post => this.renderPostHtml(post)).join('');
            } catch (e) { console.error('Cache load error:', e); }
        }

        this.bindEvents();
        this.initUserProfile();
        this.loadFeed(); // Fresh content in background
        this.setupRealtime();
    },

    setupRealtime() {
        if (!window.RemoteDB) return setTimeout(() => this.setupRealtime(), 500);
        
        window.RemoteDB.subscribeToRealtime('activities', () => {
             if (window.scrollY < 300 && !this.currentSearch) {
                this.loadFeed();
             }
        });

        window.RemoteDB.subscribeToRealtime('post_reactions', () => this.loadFeed());
    },

    bindEvents() {
        if (this.textarea) {
            this.textarea.addEventListener('input', () => this.handleTextInput());
        }

        const searchInput = document.getElementById('postSearch');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));
        }

        document.querySelectorAll('[data-category]').forEach(btn => {
            btn.addEventListener('click', () => {
                const cat = btn.getAttribute('data-category');
                this.setCategory(cat);
            });
        });

        document.addEventListener('click', (e) => {
            if (this.emojiPicker && !this.emojiPicker.contains(e.target) && !e.target.closest('#emojiTrigger')) {
                this.emojiPicker.classList.add('hidden');
            }
        });
    },

    toggleEmojiPicker() {
        if (!this.emojiPicker) return;
        this.emojiPicker.classList.toggle('hidden');
        if (!this.emojiPicker.classList.contains('hidden') && this.emojiGrid && this.emojiGrid.children.length === 0) {
            this.renderEmojiGrid();
        }
    },

    renderEmojiGrid() {
        const emojis = ['🙂', '😀', '😄', '😁', '😅', '😂', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😋', '😛', '😜', '🤔', '🤨', '😐', '😑', '😶', '🙄', '😏', '😣', '😥', '😮', '😯', '😪', '😫', '😴', '😌', '🤓', '🧐', '😕', '🙃', '🫠', '🥹', '❤️', '🧡', '💛', '💚', '💙', '💜', '👍', '👎', '👌', '✌️', '🤞', '🤙', '🙌', '👏', '🙏', '🤝', '💪', '✨', '🌟', '🔥', '💧', '🌊', '🌱', '🌍'];
        if (this.emojiGrid) {
            this.emojiGrid.innerHTML = emojis.map(emoji => `
                <button type="button" class="text-xl p-1 hover:bg-primary/20 rounded transition-colors" onclick="Community.insertEmoji('${emoji}')">
                    ${emoji}
                </button>
            `).join('');
        }
    },

    insertEmoji(emoji) {
        if (!this.textarea) return;
        const start = this.textarea.selectionStart;
        const end = this.textarea.selectionEnd;
        const text = this.textarea.value;
        this.textarea.value = text.substring(0, start) + emoji + text.substring(end);
        this.textarea.focus();
        this.textarea.selectionStart = this.textarea.selectionEnd = start + emoji.length;
        this.handleTextInput();
        this.emojiPicker.classList.add('hidden');
    },

    initUserProfile() {
        const checkAuth = setInterval(() => {
            if (window.Auth) {
                const user = window.Auth.getUser();
                if (user && (user.status === 'approved' || user.role === 'admin')) {
                    if (this.avatarImg) {
                        const avatarSrc = user.avatar && !user.avatar.includes('logo.png') ? user.avatar : null;
                        if (avatarSrc) {
                            this.avatarImg.src = avatarSrc;
                            this.avatarImg.classList.remove('hidden');
                        } else {
                            this.avatarImg.classList.add('hidden');
                            if (this.avatarImg.nextElementSibling?.id === 'composerAvatarPlaceholder') {
                                this.avatarImg.nextElementSibling.classList.remove('hidden');
                            }
                        }
                    }
                    if (this.usernameSpan) this.usernameSpan.textContent = user.username;
                    if (this.composer) this.composer.style.display = 'block';
                } else {
                    if (this.composer) this.composer.style.display = 'none';
                }
                clearInterval(checkAuth);
            }
        }, 100);
    },

    async loadFeed(append = false, filters = {}) {
        if (this.loading) return;
        this.loading = true;

        if (!append) {
            this.currentPage = 1;
            if (!this.feedContainer.innerHTML) {
                this.feedContainer.innerHTML = '<div class="flex justify-center py-20"><div class="animate-spin rounded-full h-12 w-12 border-4 border-primary border-t-transparent shadow-lg shadow-primary/20"></div></div>';
            }
        }

        try {
            // Wait for RemoteDB if not yet ready
            if (!window.RemoteDB) {
                let retries = 0;
                while (!window.RemoteDB && retries < 10) {
                    await new Promise(r => setTimeout(r, 100));
                    retries++;
                }
            }
            if (!window.RemoteDB) throw new Error('RemoteDB not available');

            const posts = await window.RemoteDB.getCommunityPosts({
                category: filters.category || this.currentCategory,
                search: filters.search || this.currentSearch,
                page: this.currentPage,
                pageSize: this.pageSize
            });

            if (posts && posts.length > 0) {
                const html = posts.map(post => this.renderPostHtml(post)).join('');
                if (append) {
                    this.feedContainer.insertAdjacentHTML('beforeend', html);
                } else {
                    this.feedContainer.innerHTML = html;
                    if (this.currentPage === 1 && !filters.search && !this.isHomePage) {
                        localStorage.setItem('oasis_community_feed', JSON.stringify(posts.slice(0, 10)));
                    }
                }
                this.currentPage++;
                this.hasMore = posts.length === this.pageSize && !this.isHomePage;
                if (!this.isHomePage) this.renderLoadMoreButton();
            } else {
                this.hasMore = false;
                if (!append) {
                    this.feedContainer.innerHTML = '<div class="text-center py-20 text-slate-500"><p>No updates found.</p></div>';
                }
                if (!this.isHomePage) this.renderLoadMoreButton();
            }
        } catch (error) {
            console.error('Error loading feed:', error);
            if (!append) this.feedContainer.innerHTML = '<div class="text-center py-20 text-red-500 font-bold"><p>Failed to load updates.</p></div>';
        } finally {
            this.loading = false;
        }
    },

    renderLoadMoreButton() {
        const existing = document.getElementById('loadMoreContainer');
        if (existing) existing.remove();

        if (!this.hasMore) {
            this.feedContainer.insertAdjacentHTML('beforeend', '<div id="loadMoreContainer" class="text-center py-8 text-slate-400 text-xs font-bold uppercase">You have reached the end</div>');
            return;
        }

        const btnHtml = `
            <div id="loadMoreContainer" class="flex justify-center py-8">
                <button id="loadMoreBtn" onclick="Community.loadMore()" 
                    class="px-8 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full text-slate-600 dark:text-slate-400 font-black uppercase tracking-widest text-[10px] hover:bg-primary hover:text-white transition-all shadow-sm">
                    Load More Updates
                </button>
            </div>
        `;
        this.feedContainer.insertAdjacentHTML('beforeend', btnHtml);
    },

    async loadMore() {
        await this.loadFeed(true);
    },

    setCategory(category) {
        this.currentCategory = category;
        this.loadFeed();
        document.querySelectorAll('[data-category]').forEach(btn => {
            const isMatch = btn.getAttribute('data-category') === category;
            btn.classList.toggle('bg-primary', isMatch);
            btn.classList.toggle('text-background-dark', isMatch);
            btn.classList.toggle('bg-primary/10', !isMatch);
        });
    },

    handleSearch(query) {
        this.currentSearch = query;
        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => this.loadFeed(), 300);
    },

    renderPostMedia(post) {
        const media = post.post_media || post.media_items || (post.media_url ? [{ url: post.media_url, type: post.media_type || 'image' }] : []);
        if (!media || media.length === 0) return '';

        if (media.length === 1) {
            const m = media[0];
            if (m.type === 'video') {
                return `<div class="aspect-video w-full bg-black flex items-center justify-center rounded-xl overflow-hidden"><video class="w-full h-full object-cover" controls preload="metadata" loading="lazy"><source src="${m.url}" type="video/mp4"></video></div>`;
            }
            return `<div class="aspect-[4/3] w-full bg-slate-200 dark:bg-slate-800 rounded-xl overflow-hidden shadow-sm ring-1 ring-black/5"><img src="${m.url}" class="w-full h-full object-cover hover:scale-105 transition-transform duration-500" loading="lazy" onclick="window.open('${m.url}', '_blank')"></div>`;
        }

        const gridCols = media.length === 2 ? 'grid-cols-2' : 'grid-cols-2';
        const displayMedia = media.slice(0, 4);

        return `<div class="grid ${gridCols} gap-1.5 rounded-xl overflow-hidden shadow-sm ring-1 ring-black/5">
            ${displayMedia.map((m, idx) => {
                let spanClass = '';
                if (media.length === 3 && idx === 0) spanClass = 'col-span-2 aspect-video';
                else spanClass = 'aspect-square';

                return `
                <div class="relative ${spanClass} bg-slate-100 dark:bg-slate-900 overflow-hidden cursor-zoom-in group/media">
                    <img src="${m.url}" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" loading="lazy" onclick="window.open('${m.url}', '_blank')">
                    ${idx === 3 && media.length > 4 ? `
                        <div class="absolute inset-0 bg-black/60 backdrop-blur-[2px] flex flex-col items-center justify-center text-white p-4" onclick="window.open('${m.url}', '_blank')">
                            <span class="font-black text-2xl">+${media.length - 4}</span>
                            <span class="text-[10px] font-bold uppercase tracking-widest text-white/70">More Files</span>
                        </div>
                    ` : ''}
                </div>`;
            }).join('')}
        </div>`;
    },

    renderPostHtml(post) {
        const mediaHtml = this.renderPostMedia(post);
        const username = post.profiles?.username || post.author_username || 'Member';
        const avatar = post.profiles?.avatar_url || post.author_avatar || null;
        const role = post.profiles?.role || post.author_role || 'community';
        const isAnnouncement = post.tag === 'Announcement' || post.tag === 'Official';

        const cardClasses = isAnnouncement
            ? "bg-slate-900 border-2 border-primary/40 p-6 mb-6 rounded-2xl relative overflow-hidden group/post"
            : "bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/50 p-5 mb-4 group/post";

        return `
        <div class="${cardClasses}" data-post-id="${post.id}">
            <div class="flex items-center gap-3 mb-4">
                <div class="w-10 h-10 rounded-full border border-primary/10 overflow-hidden flex items-center justify-center bg-slate-50 dark:bg-slate-700">
                    ${avatar ? `<img src="${avatar}" class="w-full h-full object-cover">` : `<span class="material-symbols-outlined text-slate-400">person</span>`}
                </div>
                <div class="flex-1">
                    <div class="flex items-center gap-2">
                        <h4 class="font-bold text-sm ${isAnnouncement ? 'text-white' : 'text-slate-900 dark:text-white'}">${username}</h4>
                        ${this.renderRoleBadge(role)}
                    </div>
                    <p class="text-[10px] text-slate-500 font-bold uppercase tracking-widest opacity-70">${new Date(post.created_at).toLocaleDateString()}</p>
                </div>
                <div class="relative group/menu">
                    <button class="size-8 flex items-center justify-center text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full"><span class="material-symbols-outlined">more_horiz</span></button>
                    <div class="absolute top-full right-0 mt-1 w-48 bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl shadow-xl hidden group-hover/menu:block z-50 p-1">
                        ${this.renderPostActions(post)}
                    </div>
                </div>
            </div>
            <div class="${isAnnouncement ? 'text-slate-100 text-lg' : 'text-slate-700 dark:text-slate-300 text-[15px]'} leading-relaxed mb-4 whitespace-pre-wrap">${this.highlightHashtags(post.text)}</div>
            ${mediaHtml ? `<div class="mt-4 rounded-xl overflow-hidden">${mediaHtml}</div>` : ''}
            ${post.is_optimistic ? `
                <div class="mt-4 flex items-center gap-2 text-slate-400 text-[10px] uppercase font-black tracking-widest"><span class="material-symbols-outlined animate-spin text-sm">sync</span> Syncing...</div>
            ` : `
                <div class="mt-5 flex items-center justify-between pt-4 border-t border-slate-50 dark:border-slate-800/50">
                    <div class="flex items-center gap-4">
                        <div class="relative group/react">
                            <button class="flex items-center gap-2 text-slate-500 hover:text-primary transition-colors"><span class="material-symbols-outlined text-[18px]">favorite</span><span class="text-[11px] font-bold">${post.reaction_count || 0}</span></button>
                            <div class="absolute bottom-full left-0 mb-2 p-1 bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-full shadow-lg flex gap-1 opacity-0 pointer-events-none group-hover/react:opacity-100 group-hover/react:pointer-events-auto transition-all scale-95 origin-bottom-left">
                                ${['👍', '❤️', '😂', '😮', '😢'].map(emoji => `<button onclick="Community.reactToPost('${post.id}', '${emoji}')" class="size-8 flex items-center justify-center hover:scale-125 transition-transform text-lg">${emoji}</button>`).join('')}
                            </div>
                        </div>
                        <button onclick="Community.toggleComments('${post.id}')" class="flex items-center gap-2 text-slate-500 hover:text-primary transition-colors"><span class="material-symbols-outlined text-[18px]">chat_bubble</span><span class="text-[11px] font-bold">${post.comments_count || 0}</span></button>
                    </div>
                </div>
            `}
            <div id="comments-${post.id}" class="hidden mt-4 pt-4 border-t border-slate-50 dark:border-slate-800/50">
                <div id="comment-list-${post.id}" class="flex flex-col gap-3"></div>
                <div class="mt-4 flex gap-2"><input type="text" placeholder="Add a comment..." class="flex-1 bg-slate-100 dark:bg-slate-700 border-none rounded-full px-4 py-2 text-xs" onkeydown="if(event.key==='Enter') Community.submitComment('${post.id}', this.value, this)"></div>
            </div>
        </div>`;
    },

    async submitPost() {
        const text = this.textarea.value.trim();
        const mediaToUpload = [...this.selectedMedia];
        if (!text && mediaToUpload.length === 0) return;

        const user = window.Auth.getUser();
        if (!user) return alert('Please login to post.');

        // If any are still uploading, we show a warning or wait. 
        // For better UX, let's wait up to a few seconds if they are almost done, otherwise alert.
        const stillUploading = mediaToUpload.some(m => m.progress > 0 && m.progress < 100);
        if (stillUploading) {
            alert('Please wait for your media to finish uploading.');
            return;
        }

        const failed = mediaToUpload.some(m => m.progress === -1);
        if (failed) {
            alert('Some media failed to upload. Please remove them and try again.');
            return;
        }

        this.textarea.value = '';
        this.selectedMedia = [];
        this.renderPreviews();
        this.handleTextInput();

        const tempId = 'temp-' + Date.now();
        const optimisticPost = { 
            id: tempId, 
            text: text, 
            created_at: new Date().toISOString(), 
            author_username: user.username, 
            author_avatar: user.avatar, 
            author_role: user.role, 
            media_items: mediaToUpload.map(m => ({ url: m.previewUrl, type: m.type })), 
            is_optimistic: true 
        };
        this.feedContainer.insertAdjacentHTML('afterbegin', this.renderPostHtml(optimisticPost));
        
        try {
            const media_items = mediaToUpload
                .filter(m => m.url)
                .map(m => ({ url: m.url, type: m.type }));

            const realPost = await window.RemoteDB.addCommunityPost({ 
                text, 
                media_items, 
                tag: this.currentCategory !== 'All Updates' ? this.currentCategory : 'Community' 
            });

            if (realPost) {
                const optEl = document.querySelector(`[data-post-id="${tempId}"]`);
                if (optEl) {
                    optEl.outerHTML = this.renderPostHtml(realPost);
                    this.updateCache();
                }
            } else throw new Error('Post failed');
        } catch (error) {
            console.error('Post submission error:', error);
            const optEl = document.querySelector(`[data-post-id="${tempId}"]`);
            if (optEl) optEl.remove();
            alert('Failed to submit post.');
        }
    },

    updateCache() {
        if (this.isHomePage) return;
        const posts = Array.from(this.feedContainer.querySelectorAll('[data-post-id]'))
            .filter(el => !el.querySelector('.animate-spin')) // Don't cache optimistic
            .slice(0, 10)
            .map(el => {
                // This is a bit hacky, maybe just reload first 10 correctly
                return null;
            });
        // Better: just trigger a loadFeed(false) if we want absolute fresh cache, 
        // but for now, the reload on next visit is fine.
    },

    async reactToPost(postId, emoji) {
        const user = window.Auth?.getUser();
        if (!user) return alert('Please login to react');
        const success = await window.RemoteDB.toggleReaction('post', postId, emoji);
        if (success) this.loadFeed();
    },

    renderPostActions(post) {
        const user = window.Auth?.getUser();
        const isAuthor = user && user.id === post.author_id;
        const isAdmin = user && user.role === 'admin';
        let html = `<button onclick="Community.copyPostLink('${post.id}')" class="flex items-center gap-2 w-full p-2 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg text-xs font-bold"> <span class="material-symbols-outlined text-sm">link</span> Copy Link </button>`;
        if (isAuthor || isAdmin) html += `<button onclick="Community.deletePost('${post.id}')" class="flex items-center gap-2 w-full p-2 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-lg text-xs font-bold text-red-500"> <span class="material-symbols-outlined text-sm">delete</span> Delete </button>`;
        return html;
    },

    async deletePost(postId) {
        if (confirm('Delete post?')) {
            const success = await window.RemoteDB.deleteActivity(postId);
            if (success) {
                const el = document.querySelector(`[data-post-id="${postId}"]`);
                if (el) el.remove();
            }
        }
    },

    async toggleComments(postId) {
        const el = document.getElementById(`comments-${postId}`);
        if (!el) return;
        el.classList.toggle('hidden');
        if (!el.classList.contains('hidden')) this.loadComments(postId);
    },

    async loadComments(postId) {
        const list = document.getElementById(`comment-list-${postId}`);
        list.innerHTML = '<div class="py-4 text-center animate-pulse text-[10px] text-slate-400">Loading...</div>';
        try {
            const comments = await window.RemoteDB.getComments(postId);
            if (!comments || comments.length === 0) {
                list.innerHTML = '<p class="py-2 text-center text-xs text-slate-400">No comments yet.</p>';
                return;
            }
            list.innerHTML = comments.map(c => `
                <div class="flex gap-2">
                    <div class="size-6 rounded-full overflow-hidden bg-slate-100 flex items-center justify-center shrink-0">
                        ${c.profiles?.avatar_url ? `<img src="${c.profiles.avatar_url}" class="w-full h-full object-cover">` : `<span class="material-symbols-outlined text-[12px] text-slate-400">person</span>`}
                    </div>
                    <div class="flex-1 bg-slate-50 dark:bg-slate-700/50 p-2 rounded-xl">
                        <p class="text-[10px] font-black uppercase text-slate-900 dark:text-white">${c.profiles?.username || 'User'}</p>
                        <p class="text-xs text-slate-700 dark:text-slate-300">${c.content || c.text}</p>
                    </div>
                </div>
            `).join('');
        } catch (e) { list.innerHTML = '<p class="text-red-500 text-[10px]">Error loading comments</p>'; }
    },

    async submitComment(postId, text, input) {
        if (!text.trim()) return;
        const success = await window.RemoteDB.addComment(postId, text.trim());
        if (success) {
            input.value = '';
            this.loadComments(postId);
        }
    },

    handleTextInput() {
        const length = this.textarea.value.length;
        if (this.charCounter) this.charCounter.textContent = `${length} / ${this.maxTextLength}`;
        this.updateSubmitButtonState();
    },

    updateSubmitButtonState() {
        if (this.submitBtn) this.submitBtn.disabled = !this.textarea.value.trim() && this.selectedMedia.length === 0;
    },

    async handleMediaSelect(event, type) {
        const files = Array.from(event.target.files);
        for (const file of files) {
            const id = Date.now() + Math.random();
            const item = { 
                file, 
                type: type === 'photo' ? 'image' : type, 
                previewUrl: URL.createObjectURL(file), 
                id: id,
                progress: 10,
                url: null 
            };
            
            this.selectedMedia.push(item);
            this.renderPreviews();
            this.updateSubmitButtonState();

            // Start upload immediately in background
            window.RemoteDB.uploadMedia([file], {
                onProgress: (idx, pct) => {
                    const mediaItem = this.selectedMedia.find(m => m.id === id);
                    if (mediaItem) {
                        mediaItem.progress = pct;
                        this.renderPreviews();
                    }
                }
            }).then(urls => {
                const mediaItem = this.selectedMedia.find(m => m.id === id);
                if (mediaItem && urls[0]) {
                    mediaItem.url = urls[0];
                    mediaItem.progress = 100;
                    this.renderPreviews();
                    this.updateSubmitButtonState();
                }
            }).catch(err => {
                console.error('Upload failed for item:', id, err);
                const mediaItem = this.selectedMedia.find(m => m.id === id);
                if (mediaItem) {
                    mediaItem.progress = -1;
                    this.renderPreviews();
                }
            });
        }
    },

    renderPreviews() {
        if (!this.mediaPreview) return;
        this.mediaPreview.innerHTML = this.selectedMedia.map(m => `
            <div class="relative size-24 rounded-xl overflow-hidden shrink-0 border border-slate-200 dark:border-slate-700 shadow-sm bg-slate-100 dark:bg-slate-900">
                <img src="${m.previewUrl}" class="w-full h-full object-cover ${m.progress < 100 && m.progress !== -1 ? 'opacity-40 grayscale' : ''}">
                ${m.progress < 100 && m.progress !== -1 ? `
                    <div class="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/20">
                        <div class="size-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></div>
                        <span class="text-[8px] font-black text-white uppercase tracking-tighter">${m.progress}%</span>
                    </div>
                ` : ''}
                ${m.progress === -1 ? `
                    <div class="absolute inset-0 flex flex-col items-center justify-center bg-red-500/20">
                        <span class="material-symbols-outlined text-red-500 text-lg">error</span>
                    </div>
                ` : ''}
                <button onclick="Community.removeMedia('${m.id}')" class="absolute top-1 right-1 size-6 bg-black/60 hover:bg-red-500 text-white rounded-full flex items-center justify-center text-xs backdrop-blur-sm transition-colors">×</button>
            </div>
        `).join('');
    },

    removeMedia(id) {
        this.selectedMedia = this.selectedMedia.filter(m => m.id !== id);
        this.renderPreviews();
        this.updateSubmitButtonState();
    },

    highlightHashtags(text) {
        return (text || '').replace(/#(\w+)/g, '<span class="text-primary font-bold">#$1</span>');
    },

    renderRoleBadge(role) {
        let colors = 'bg-primary/20 text-primary';
        if (role === 'admin') colors = 'bg-red-500/20 text-red-600';
        return `<span class="text-[9px] ${colors} px-1.5 py-0.5 rounded font-black uppercase tracking-wider">${role}</span>`;
    },

    async copyPostLink(postId) {
        const url = `${window.location.origin}/post/${postId}`;
        await navigator.clipboard.writeText(url);
        alert('Link copied!');
    }
};

Community.init();
