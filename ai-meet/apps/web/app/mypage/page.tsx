'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createPagesBrowserClient } from '@supabase/auth-helpers-nextjs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { User } from '@supabase/supabase-js';

interface Profile {
  username: string | null;
  avatar_url: string | null;
}

export default function MyPage() {
  const router = useRouter();
  const [supabase] = useState(() => createPagesBrowserClient());
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [profile, setProfile] = useState<Profile>({ username: null, avatar_url: null });
  const [initialProfile, setInitialProfile] = useState<Profile | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  useEffect(() => {
    async function getProfile() {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        router.push('/login');
        return;
      }
      setCurrentUser(user);

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error) {
        console.warn(error);
      } else if (data) {
        setProfile(data);
        setInitialProfile(data);
      }

      setLoading(false);
    }

    getProfile();
  }, [supabase, router]);

  const handleSave = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      router.push('/login');
      return;
    }

    // Step 1: If avatar was removed by the user, delete the old file from storage first.
    if (initialProfile?.avatar_url && !profile.avatar_url) {
      const oldAvatarPath = initialProfile.avatar_url.substring(initialProfile.avatar_url.indexOf('/avatars/') + '/avatars/'.length);
      if (oldAvatarPath) {
        await supabase.storage.from('avatars').remove([oldAvatarPath]);
      }
    }

    // Step 2: Prepare the data to be saved, reverting to defaults if fields are empty.
    let usernameToSave = profile.username;
    let avatarUrlToSave = profile.avatar_url;
    let message = '';

    if (!usernameToSave || usernameToSave.trim() === '') {
      usernameToSave = user.user_metadata.full_name || user.email || null;
      message += '닉네임이 비어있어 Google 계정 이름으로 자동 설정됩니다.\n';
    }

    if (!avatarUrlToSave || avatarUrlToSave.trim() === '') {
      avatarUrlToSave = user.user_metadata.avatar_url || null;
      if (user.user_metadata.avatar_url) {
        message += '프로필 사진이 비어있어 Google 계정 사진으로 자동 설정됩니다.\n';
      } else {
        message += '프로필 사진이 비어있습니다.\n';
      }
    }

    if (message) {
      alert(message);
    }

    // Step 3: Update the database with the prepared data.
    const { error } = await supabase.from('profiles').update({
      username: usernameToSave,
      avatar_url: avatarUrlToSave,
      updated_at: new Date().toISOString(),
    }).eq('id', user.id);

    if (error) {
      alert('Error updating the data: ' + error.message);
    } else {
      setInitialProfile({ username: usernameToSave, avatar_url: avatarUrlToSave });
      alert('Profile saved successfully!');
    }

    setLoading(false);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      setUploading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user on the session!');

      if (!event.target.files || event.target.files.length === 0) {
        throw new Error('You must select an image to upload.');
      }

      const file = event.target.files[0];
      const fileExt = file.name.split('.').pop();
      const filePath = `${user.id}/${Date.now()}.${fileExt}`;

      if (file.size > 2 * 1024 * 1024) {
        throw new Error('File size must be less than 2MB.');
      }

      // If there's an old avatar, remove it from storage
      if (profile.avatar_url) {
        const oldAvatarPath = profile.avatar_url.substring(profile.avatar_url.indexOf('/avatars/') + '/avatars/'.length);
        if (oldAvatarPath) {
          await supabase.storage.from('avatars').remove([oldAvatarPath]);
        }
      }

      const { error: uploadError } = await supabase.storage.from('avatars').upload(filePath, file);

      if (uploadError) {
        throw uploadError;
      }

      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(filePath);
      
      setProfile({ ...profile, avatar_url: publicUrl });

    } catch (error: any) {
      alert(error.message);
    } finally {
      setUploading(false);
    }
  };

  const isGoogleDefaultAvatar = currentUser && profile.avatar_url === currentUser.user_metadata.avatar_url;

  if (loading) {
    return <div className="flex justify-center items-center min-h-screen">Loading profile...</div>;
  }

  return (
    <div className="flex justify-center items-center min-h-screen">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">My Profile</CardTitle>
          {currentUser && <p className="text-sm text-muted-foreground">Email: {currentUser.email}</p>}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">Nickname</Label>
            <Input
              id="username"
              type="text"
              value={profile.username || ''}
              onChange={(e) => setProfile({ ...profile, username: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Profile Picture</Label>
            <div className="flex items-center gap-4">
              {profile.avatar_url && (
                <img src={profile.avatar_url} alt="Avatar" className="w-24 h-24 rounded-full object-cover" />
              )}
              <div className="flex-grow space-y-2">
                <Input id="avatar-upload" type="file" accept="image/*" onChange={handleFileUpload} disabled={uploading} />
                {profile.avatar_url && !isGoogleDefaultAvatar && (
                  <Button variant="outline" size="sm" onClick={() => setProfile({ ...profile, avatar_url: null })}>
                    Remove Profile Picture
                  </Button>
                )}
              </div>
            </div>
            {uploading && <p>Uploading...</p>}
          </div>
          <Button onClick={handleSave} disabled={loading || uploading} className="w-full">
            {loading ? 'Saving...' : 'Save Profile'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}


