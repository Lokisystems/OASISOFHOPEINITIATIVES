/* RemoteDB + Supabase bridge */

(function () {
    const RemoteDB = {
        client: null,
        available: false,

        async init() {
            const config = window.SUPABASE_CONFIG;

            if (!config || !config.url || !config.key) {
                console.warn('Supabase not configured. Config missing.');
                this.available = false;
                return false;
            }

            try {
                if (window.supabase) {
                    this.client = window.supabase.createClient(config.url, config.key);
                    this.available = true;
                    console.log('Supabase client initialized');
                } else {
                    console.warn('Supabase SDK not found in window. Make sure the script is loaded.');
                    alert('Critical: Supabase SDK failed to load. Please check your internet connection and script tags.');
                    this.available = false;
                }
            } catch (e) {
                console.warn('Supabase init error', e);
                this.available = false;
            }
            return this.available;
        },

        subscribeToRealtime(table, callback) {
            if (!this.available) return null;
            return this.client
                .channel(`public:${table}`)
                .on('postgres_changes', { event: '*', schema: 'public', table: table }, payload => {
                    callback(payload);
                })
                .subscribe();
        },

        // --- Auth & User Methods ---
        async getUser() {
            if (!this.available) return null;
            const { data: { user } } = await this.client.auth.getUser();
            return user;
        },

        async getProfile(userId) {
            if (!this.available || !userId) return null;
            const { data } = await this.client
                .from('profiles')
                .select('*')
                .eq('id', userId)
                .single();
            return data;
        },

        // --- Community Post Methods ---
        async getCommunityPosts(options = {}) {
            if (!this.available) return [];
            let { limit = null, offset = 0, category = null, search = null, page = null, pageSize = null } = options;
            
            // Handle pagination patterns
            if (page && pageSize) {
                limit = pageSize;
                offset = (page - 1) * pageSize;
            }

            try {
                let query = this.client
                    .from('activities')
                    .select(`
                        *,
                        profiles(username, avatar_url, full_name, role),
                        post_media(*),
                        post_reactions(*)
                    `)
                    .eq('is_hidden', false)
                    .order('is_pinned', { ascending: false })
                    .order('created_at', { ascending: false });

                if (category && category !== 'All Updates') {
                    query = query.eq('tag', category);
                }

                if (search) {
                    query = query.ilike('text', `%${search}%`);
                }

                if (limit !== null) {
                    const from = offset;
                    const to = from + limit - 1;
                    query = query.range(from, to);
                }

                const { data, error } = await query;

                if (error) throw error;
                return data;
            } catch (e) {
                console.error('Error fetching community posts:', e);
                return [];
            }
        },

        async addCommunityPost(postData) {
            if (!this.available) return null;

            const user = window.Auth?.getUser() || await this.getUser();
            if (!user) return null;

            const profile = window.Auth?.profile || await this.getProfile(user.id);
            if (!profile || (profile.status !== 'approved' && profile.role !== 'admin')) {
                alert('Account pending approval.');
                return null;
            }

            // 1. Create the post first
            const payload = {
                author_id: user.id,
                text: postData.text || '',
                tag: postData.tag || 'Community',
                media_type: postData.media_items?.length > 1 ? 'image' : (postData.media_items?.[0]?.type || 'none'),
                media_url: postData.media_items?.[0]?.url || null // Backward compatibility
            };

            const { data: post, error } = await this.client
                .from('activities')
                .insert([payload])
                .select()
                .single();

            if (error) throw error;

            // 2. If multiple media, insert into post_media
            if (postData.media_items && postData.media_items.length > 0) {
                const mediaPayload = postData.media_items.map(m => ({
                    post_id: post.id,
                    url: m.url,
                    type: m.type || 'image'
                }));
                await this.client.from('post_media').insert(mediaPayload);
            }

            // 3. Return enriched post object for seamless optimistic replacement
            return {
                ...post,
                post_media: postData.media_items || [],
                profiles: {
                    username: profile.username,
                    avatar_url: profile.avatar_url,
                    role: profile.role
                }
            };
        },

        async toggleReaction(contentType, contentId, reactionType = '👍') {
            if (!this.available) return false;
            const user = await this.getUser();
            if (!user) return false;

            const table = contentType === 'post' ? 'post_reactions' : 'comment_reactions';
            const idField = contentType === 'post' ? 'post_id' : 'comment_id';

            try {
                // Check for existing reaction
                const { data: existing } = await this.client
                    .from(table)
                    .select('*')
                    .eq(idField, contentId)
                    .eq('user_id', user.id)
                    .single();

                if (existing) {
                    if (existing.reaction_type === reactionType) {
                        // Remove if identical
                        await this.client.from(table).delete().eq('id', existing.id);
                    } else {
                        // Update if different
                        await this.client.from(table).update({ reaction_type: reactionType }).eq('id', existing.id);
                    }
                } else {
                    // Insert new
                    await this.client.from(table).insert([{
                        [idField]: contentId,
                        user_id: user.id,
                        reaction_type: reactionType
                    }]);
                }
                return true;
            } catch (err) {
                console.error('Reaction toggle failed:', err);
                return false;
            }
        },

        async compressImage(file, maxWidth = 1200, quality = 0.5) {
            if (!file.type.startsWith('image/')) return file;
            
            // Fast-path: if file is already small (e.g. < 200KB), don't compress
            if (file.size < 200 * 1024) return file;

            return new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;
                    
                    // Maintain aspect ratio while scaling down
                    if (width > maxWidth) {
                        height = Math.round((maxWidth / width) * height);
                        width = maxWidth;
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    
                    // Use better image smoothing
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = 'medium';
                    
                    ctx.drawImage(img, 0, 0, width, height);
                    
                    canvas.toBlob((blob) => {
                        const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".jpg", { type: 'image/jpeg' });
                        console.log(`[RemoteDB] Optimized: ${(file.size / 1024).toFixed(0)}KB → ${(blob.size / 1024).toFixed(0)}KB`);
                        resolve(compressedFile);
                    }, 'image/jpeg', quality);
                };
                img.src = URL.createObjectURL(file);
            });
        },

        async uploadMedia(mediaItems, options = {}) {
            if (!this.available || !mediaItems || mediaItems.length === 0) return [];

            let userId = 'anonymous';
            try {
                const { data: { user } } = await this.client.auth.getUser();
                if (user) userId = user.id;
            } catch (e) {
                console.warn('[RemoteDB] Could not get user for upload:', e);
            }

            const maxWidth = options.maxWidth || 1200;
            const quality = options.quality || 0.5;
            const onProgress = options.onProgress || (() => {});

            // Use Promise.all for true parallelism if multiple items are passed
            const uploadPromises = mediaItems.map(async (item, index) => {
                let file = item.file || item;
                if (!file || !file.name) return null;

                onProgress(index, 10); // 10% - Started

                // Compress images
                if (file.type.startsWith('image/')) {
                    onProgress(index, 30); // 30% - Compressing
                    file = await this.compressImage(file, maxWidth, quality);
                }

                const fileExt = file.name.split('.').pop();
                const now = new Date();
                const year = now.getFullYear();
                const month = String(now.getMonth() + 1).padStart(2, '0');

                const fileName = `${Math.random().toString(36).substring(2)}-${Date.now()}.${fileExt}`;
                const filePath = `${userId}/${year}/${month}/${fileName}`;

                onProgress(index, 50); // 50% - Uploading

                const { data, error } = await this.client.storage
                    .from('community-media')
                    .upload(filePath, file, {
                        cacheControl: '3600',
                        upsert: false
                    });

                if (error) {
                    onProgress(index, -1); // Error state
                    console.error('Upload error:', error);
                    throw error;
                }

                onProgress(index, 100); // 100% - Done

                const { data: { publicUrl } } = this.client.storage
                    .from('community-media')
                    .getPublicUrl(filePath);

                return publicUrl;
            });

            return Promise.all(uploadPromises);
        },

        async getUsersByStatus(status = 'pending', page = 1, pageSize = 50) {
            if (!this.available) return [];
            
            const from = (page - 1) * pageSize;
            const to = from + pageSize - 1;

            let query = this.client.from('profiles').select('*');
            
            if (status !== 'all') {
                query = query.eq('status', status);
            }
            
            const { data, error } = await query
                .order('created_at', { ascending: false })
                .range(from, to);

            if (error) {
                console.error('Error fetching users:', error);
                return [];
            }
            return data;
        },

        async updateUserStatus(userId, status) {
            console.log(`Attempting to update user ${userId} to ${status}`);
            if (!this.available || !userId) {
                console.error('RemoteDB not available or userId missing');
                return false;
            }
            try {
                const { data, error } = await this.client
                    .from('profiles')
                    .update({ status: status })
                    .eq('id', userId)
                    .select();

                if (error) {
                    console.error('Database update error:', error);
                    return false;
                }

                console.log('Update success:', data);
                return true;
            } catch (err) {
                console.error('Unexpected update error:', err);
                return false;
            }
        },

        async getAuditLogs(limit = 10) {
            if (!this.available) return [];
            try {
                const { data, error } = await this.client
                    .from('audit_logs')
                    .select('*, profiles!audit_logs_admin_id_fkey(username)')
                    .order('created_at', { ascending: false })
                    .limit(limit);
                if (error) throw error;
                return data;
            } catch (err) {
                console.error('[RemoteDB] Error fetching audit logs:', err);
                return [];
            }
        },

        async logAdminAction(action, targetUser, details = '') {
            if (!this.available) return false;
            try {
                const { data: { user } } = await this.client.auth.getUser();
                if (!user) return false;

                const { error } = await this.client
                    .from('audit_logs')
                    .insert([{
                        admin_id: user.id,
                        action: action,
                        target_user: targetUser,
                        details: details
                    }]);
                if (error) throw error;
                return true;
            } catch (err) {
                console.error('[RemoteDB] Error logging admin action:', err);
                return false;
            }
        },

        async updateProfile(updates) {
            if (!this.available) return { success: false, error: 'DB not available' };
            const { email, password, phone, full_name, avatar_url, username, bio } = updates;

            try {
                // Update Auth Data
                const authUpdates = {};
                if (email) authUpdates.email = email;
                if (password) authUpdates.password = password;

                if (Object.keys(authUpdates).length > 0) {
                    const { error } = await this.client.auth.updateUser(authUpdates);
                    if (error) throw error;
                }

                // Update Profile Data
                const profileUpdates = {};
                if (full_name) profileUpdates.full_name = full_name;
                if (username) profileUpdates.username = username;
                if (email) profileUpdates.email = email;
                if (phone) profileUpdates.phone = phone;
                if (bio) profileUpdates.bio = bio;
                if (avatar_url) profileUpdates.avatar_url = avatar_url;

                const user = await this.getUser();
                const { error: pError } = await this.client
                    .from('profiles')
                    .update(profileUpdates)
                    .eq('id', user.id);

                if (pError) throw pError;

                return { success: true };
            } catch (err) {
                console.error('Profile update failed:', err);
                return { success: false, error: err.message };
            }
        },

        // --- Comment Methods ---
        async getComments(postId) {
            if (!this.available) return [];
            try {
                const { data, error } = await this.client
                    .from('comments')
                    .select(`
                        *,
                        profiles(username, avatar_url, role),
                        comment_reactions(*),
                        comment_media(*)
                    `)
                    .eq('post_id', postId)
                    .order('is_pinned', { ascending: false })
                    .order('created_at', { ascending: true });

                if (error) throw error;
                return data;
            } catch (err) {
                console.error('[RemoteDB] Error fetching comments:', err);
                return [];
            }
        },

        async addComment(postId, content, parentId = null) {
            if (!this.available) return null;
            try {
                const user = await this.getUser();
                if (!user) {
                    console.error('[RemoteDB] No user found for comment');
                    return null;
                }

                const profile = await this.getProfile(user.id);
                if (!profile || (profile.status !== 'approved' && profile.role !== 'admin')) {
                    alert('Your account is pending approval. You cannot post comments yet.');
                    return null;
                }

                const { data, error } = await this.client
                    .from('comments')
                    .insert([{
                        post_id: postId,
                        user_id: user.id,
                        content: content,
                        parent_id: parentId
                    }])
                    .select()
                    .single();

                if (error) throw error;
                
                // Update comment count on post
                await this.client.rpc('increment_comment_count', { activity_id: postId });

                return data;
            } catch (err) {
                console.error('[RemoteDB] Error adding comment:', err);
                return null;
            }
        },

        // --- Story / News Methods ---
        async getStories(limit = null) {
            if (!this.available) return [];
            try {
                let query = this.client
                    .from('stories')
                    .select('*')
                    .order('created_at', { ascending: false });

                if (limit) {
                    query = query.limit(limit);
                }

                const { data, error } = await query;
                if (error) throw error;
                return data;
            } catch (err) {
                console.error('[RemoteDB] Error fetching stories:', err);
                return [];
            }
        },

        async getStory(id) {
            if (!this.available || !id) return null;
            try {
                const { data, error } = await this.client
                    .from('stories')
                    .select('*')
                    .eq('id', id)
                    .single();
                if (error) throw error;
                return data;
            } catch (err) {
                console.error('[RemoteDB] Error fetching story:', err);
                return null;
            }
        },

        async addStory(storyData) {
            if (!this.available) return null;
            try {
                // Use the cached user from Auth to avoid a network roundtrip
                const user = window.Auth?.getUser();
                const userId = user?.id || (await this.getUser())?.id;
                
                if (!userId) {
                    console.error('[RemoteDB] No user found for story');
                    return null;
                }

                const { error } = await this.client
                    .from('stories')
                    .insert([{
                        title: storyData.title,
                        summary: storyData.summary,
                        content: storyData.content,
                        image_url: storyData.image_url,
                        category: storyData.category || 'General',
                        author_id: userId
                    }]);
                
                if (error) throw error;
                return { success: true };
            } catch (err) {
                console.error('[RemoteDB] Error adding story:', err);
                return null;
            }
        },

        // Legacy compatibility
        async deleteActivity(activityId) {
            if (!this.available) return false;
            const user = await this.getUser();
            if (!user) return false;

            try {
                const { error } = await this.client
                    .from('activities')
                    .delete()
                    .eq('id', activityId);
                if (error) throw error;
                return true;
            } catch (err) {
                console.error('Delete failed:', err);
                return false;
            }
        },

        async reportContent(type, id, reason) {
            if (!this.available) return false;
            const user = await this.getUser();
            const payload = {
                content_type: type,
                content_id: id,
                reason: reason,
                reporter_id: user?.id || null
            };
            const { error } = await this.client.from('reports').insert([payload]);
            return !error;
        },

        async updateComment(commentId, newContent) {
            if (!this.available) return false;
            const { error } = await this.client
                .from('comments')
                .update({ content: newContent, updated_at: new Date() })
                .eq('id', commentId);
            return !error;
        },

        async deleteComment(commentId) {
            if (!this.available) return false;
            const { error } = await this.client.from('comments').delete().eq('id', commentId);
            return !error;
        },

        // --- Admin Dashboard Methods ---
        async getAdminStats() {
            if (!this.available) return null;
            try {
                const { data: profiles, error: pError } = await this.client.from('profiles').select('status');
                const { count: totalPosts, error: aError } = await this.client.from('activities').select('*', { count: 'exact', head: true });

                if (pError || aError) throw (pError || aError);

                return {
                    totalUsers: profiles.length,
                    approvedUsers: profiles.filter(p => p.status === 'approved').length,
                    pendingUsers: profiles.filter(p => p.status === 'pending').length,
                    totalPosts: totalPosts || 0
                };
            } catch (err) {
                console.error('Stats failed:', err);
                return null;
            }
        },

        // --- Notifications Methods ---
        async getNotifications() {
            if (!this.available) return [];
            const user = await this.getUser();
            if (!user) return [];

            const { data, error } = await this.client
                .from('notifications')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false });

            if (error) {
                console.error('Notifications fetch error:', error);
                return [];
            }
            return data;
        },

        async markNotificationRead(id) {
            if (!this.available) return false;
            const { error } = await this.client
                .from('notifications')
                .update({ read: true })
                .eq('id', id);
            return !error;
        },

        // --- Inquiry & Engagement Methods ---
        async submitVolunteerApplication(data) {
            if (!this.available) return { success: false, error: 'DB not available' };
            const user = await this.getUser();
            try {
                const { error } = await this.client.from('volunteer_applications').insert([{
                    user_id: user?.id || null,
                    full_name: data.fullName,
                    email: data.email,
                    interest_area: data.interestArea,
                    motivation: data.motivation
                }]);
                if (error) throw error;
                return { success: true };
            } catch (err) {
                console.error('Volunteer application failed:', err);
                return { success: false, error: err.message };
            }
        },

        async submitPartnershipRequest(data) {
            if (!this.available) return { success: false, error: 'DB not available' };
            const user = await this.getUser();
            try {
                const { error } = await this.client.from('partnership_requests').insert([{
                    user_id: user?.id || null,
                    organization_name: data.organizationName,
                    contact_email: data.contactEmail,
                    mission_alignment: data.missionAlignment
                }]);
                if (error) throw error;
                return { success: true };
            } catch (err) {
                console.error('Partnership request failed:', err);
                return { success: false, error: err.message };
            }
        },

        async recordDonation(data) {
            if (!this.available) return { success: false, error: 'DB not available' };
            const user = await this.getUser();
            try {
                const { error } = await this.client.from('donations').insert([{
                    user_id: user?.id || null,
                    amount: data.amount,
                    currency: data.currency || 'USD',
                    payment_method: data.paymentMethod,
                    payment_status: data.paymentStatus || 'completed',
                    project_id: data.projectId || null,
                    checkout_request_id: data.checkoutRequestId || null,
                    merchant_request_id: data.merchantRequestId || null
                }]);
                if (error) throw error;
                return { success: true };
            } catch (err) {
                console.error('Donation record failed:', err);
                return { success: false, error: err.message };
            }
        },

        async initiateMpesaStkPush(amount, phone) {
            if (!this.available) return { success: false, error: 'DB not available' };
            try {
                // Call Supabase Edge Function
                const { data, error } = await this.client.functions.invoke('mpesa-pay', {
                    body: { 
                        amount: amount, 
                        phoneNumber: phone,
                        action: 'stkPush'
                    }
                });

                if (error) throw error;
                return { success: true, data: data };
            } catch (err) {
                console.error('[M-Pesa] STK Push failed:', err);
                return { success: false, error: err.message || 'Payment gateway connection error' };
            }
        },

        async getUnreadNotificationCount() {
            if (!this.available) return 0;
            const user = await this.getUser();
            if (!user) return 0;

            const { count, error } = await this.client
                .from('notifications')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', user.id)
                .eq('read', false);

            return error ? 0 : count;
        },

        async getPendingUsers() { return this.getUsersByStatus('pending'); },
        async getActivities() { return this.getCommunityPosts(); },

        subscribeToRealtime(table, callback) {
            if (!this.available) return null;
            return this.client
                .channel(`realtime-${table}`)
                .on('postgres_changes', { event: '*', schema: 'public', table: table }, payload => {
                    callback(payload);
                })
                .subscribe();
        }
    };

    window.RemoteDB = RemoteDB;
})();
