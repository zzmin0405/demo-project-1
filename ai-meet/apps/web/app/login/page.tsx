'use client';
import { useState, useEffect } from 'react';
import { createPagesBrowserClient } from '@supabase/auth-helpers-nextjs';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  const [supabase] = useState(() => createPagesBrowserClient());
  const [isKakaoBrowser, setIsKakaoBrowser] = useState(false);

  useEffect(() => {
    // This code runs only on the client side
    const userAgent = navigator.userAgent;
    if (userAgent.includes('KAKAOTALK')) {
      setIsKakaoBrowser(true);
    }
  }, []);

  const handleGoogleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${location.origin}/auth/callback`,
      },
    });
  };

  if (isKakaoBrowser) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl font-bold">알림</CardTitle>
            <CardDescription>
              원활한 로그인을 위해<br />
              카카오톡 인앱 브라우저가 아닌<br />
              <b>Chrome</b>이나 <b>Safari</b>와 같은<br />
              기본 브라우저에서 열어주세요.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-500 text-center">
              오른쪽 아래의 점 세 개 버튼을 누른 후<br />
              &apos;다른 브라우저로 열기&apos;를 선택하세요.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">AI-Meet</CardTitle>
          <CardDescription>Sign in to join the meeting</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleGoogleLogin} className="w-full">
            Sign in with Google
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}