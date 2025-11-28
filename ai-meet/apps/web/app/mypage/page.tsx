'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { Trash2, Video, Calendar, Users } from 'lucide-react';
import { format } from 'date-fns';

interface Meeting {
  id: string;
  title: string;
  createdAt: string;
  _count: {
    participants: number;
  };
}

export default function MyPage() {
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const [name, setName] = useState('');
  const [image, setImage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Meeting List State
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loadingMeetings, setLoadingMeetings] = useState(true);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
    if (session?.user) {
      setName(session.user.name || '');
      setImage(session.user.image || '');
      fetchMeetings();
      // Double-fetch to handle race conditions (e.g. just left a meeting)
      setTimeout(() => {
        fetchMeetings();
      }, 1000);
    }
  }, [session, status, router]);

  const fetchMeetings = async () => {
    try {
      // Add timestamp to prevent caching
      const res = await fetch(`/api/meeting/my?t=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          'Pragma': 'no-cache',
          'Cache-Control': 'no-cache'
        }
      });
      if (res.ok) {
        const data = await res.json();
        setMeetings(data.meetings);
      }
    } catch (error) {
      console.error('Failed to fetch meetings', error);
    } finally {
      setLoadingMeetings(false);
    }
  };

  const handleDelete = async (roomId: string) => {
    if (!confirm('정말로 이 회의방을 삭제하시겠습니까?')) return;

    try {
      const res = await fetch(`/api/meeting/${roomId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setMeetings(prev => prev.filter(m => m.id !== roomId));
      } else {
        alert('회의방 삭제에 실패했습니다.');
      }
    } catch (error) {
      console.error('Failed to delete meeting', error);
      alert('오류가 발생했습니다.');
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, image }),
      });

      if (res.ok) {
        await update({ name, image }); // Update session
        alert('프로필이 저장되었습니다.');
      } else {
        alert('저장에 실패했습니다.');
      }
    } catch (error) {
      console.error('Error saving profile:', error);
      alert('오류가 발생했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  if (status === 'loading') {
    return <div className="flex justify-center items-center h-screen">Loading...</div>;
  }

  return (
    <div className="container mx-auto p-4 max-w-4xl space-y-8">
      {/* Profile Section */}
      <Card>
        <CardHeader>
          <CardTitle>프로필 설정</CardTitle>
          <CardDescription>내 정보를 확인하고 수정할 수 있습니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col md:flex-row gap-8 items-start">
            <div className="flex flex-col items-center space-y-4 w-full md:w-auto">
              <div className="relative w-32 h-32">
                {image ? (
                  <Image
                    src={image}
                    alt="Profile"
                    fill
                    className="rounded-full object-cover border-4 border-primary/20"
                  />
                ) : (
                  <div className="w-32 h-32 rounded-full bg-secondary flex items-center justify-center text-5xl font-bold text-muted-foreground">
                    {name?.[0] || '?'}
                  </div>
                )}
              </div>
              <div className="text-center">
                <p className="font-medium text-muted-foreground">{session?.user?.email}</p>
              </div>
            </div>

            <div className="flex-1 space-y-4 w-full">
              <div className="space-y-2">
                <Label htmlFor="name">이름 (닉네임)</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="이름을 입력하세요"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="image">프로필 이미지 URL</Label>
                <div className="flex gap-2">
                  <Input
                    id="image"
                    value={image}
                    onChange={(e) => setImage(e.target.value)}
                    placeholder="https://example.com/image.jpg"
                    className="flex-1"
                  />
                  <div className="relative">
                    <input
                      type="file"
                      id="file-upload"
                      className="hidden"
                      accept="image/jpeg, image/png"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;

                        if (file.size > 3 * 1024 * 1024) {
                          alert('파일 크기는 3MB 이하여야 합니다.');
                          return;
                        }
                        if (!['image/jpeg', 'image/png'].includes(file.type)) {
                          alert('JPEG 또는 PNG 파일만 가능합니다.');
                          return;
                        }

                        const formData = new FormData();
                        formData.append('file', file);

                        try {
                          setIsSaving(true);
                          const res = await fetch('/api/upload', {
                            method: 'POST',
                            body: formData,
                          });

                          if (!res.ok) {
                            const data = await res.json();
                            throw new Error(data.error || 'Upload failed');
                          }

                          const data = await res.json();
                          setImage(data.url);
                        } catch (error: any) {
                          console.error('Upload error:', error);
                          alert(`업로드 실패: ${error.message}`);
                        } finally {
                          setIsSaving(false);
                        }
                      }}
                    />
                    <Button
                      variant="outline"
                      onClick={() => document.getElementById('file-upload')?.click()}
                      disabled={isSaving}
                    >
                      업로드
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  * 3MB 이하의 JPEG, PNG 파일만 업로드 가능합니다.
                </p>
              </div>

              <div className="bg-muted/50 p-3 rounded-lg text-xs text-muted-foreground">
                <p>ℹ️ 설정하지 않으면 구글 프로필 정보가 기본으로 적용됩니다.</p>
              </div>

              <Button onClick={handleSave} disabled={isSaving} className="w-full md:w-auto">
                {isSaving ? '저장 중...' : '프로필 저장'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Meeting List Section */}
      <div className="space-y-4">
        <h2 className="text-2xl font-bold px-1">내 회의 목록</h2>
        {loadingMeetings ? (
          <div className="text-center py-10 text-muted-foreground">목록을 불러오는 중...</div>
        ) : meetings.length === 0 ? (
          <Card className="bg-muted/30 border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-muted-foreground mb-4">생성한 회의가 없습니다.</p>
              <Button onClick={() => router.push('/')} variant="outline">새 회의 만들기</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {meetings.map((meeting) => (
              <Card key={meeting.id} className="hover:shadow-md transition-shadow group">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Video className="w-5 h-5 text-primary" />
                    <span className="truncate">{meeting.title}</span>
                  </CardTitle>
                  <CardDescription className="font-mono text-xs">{meeting.id}</CardDescription>
                </CardHeader>
                <CardContent className="pb-3">
                  <div className="flex flex-col gap-2 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4" />
                      {format(new Date(meeting.createdAt), 'yyyy-MM-dd HH:mm')}
                    </div>
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      참여자 {meeting._count.participants}명 (누적)
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="flex justify-between pt-0">
                  <Button variant="secondary" size="sm" onClick={() => router.push(`/meeting/${meeting.id}`)} className="w-full mr-2">
                    입장하기
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(meeting.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
