'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { CreateMeetingModal, MeetingSettings } from "@/components/create-meeting-modal";
import { useLanguage } from "@/contexts/language-context";
import { Globe } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function Home() {
  const router = useRouter();
  const [meetingId, setMeetingId] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { dict, language, setLanguage } = useLanguage();

  const handleCreateMeetingClick = () => {
    setIsModalOpen(true);
  };

  const handleStartMeeting = async (settings: MeetingSettings) => {
    setIsLoading(true);
    try {
      // Call API to create meeting with settings
      const response = await fetch('/api/meeting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: settings.title,
          isChatSaved: settings.isChatSaved
        })
      });

      if (!response.ok) {
        throw new Error('Failed to create meeting');
      }

      const data = await response.json();
      const newRoomId = data.roomId;

      // Store client-side preferences (join options) in sessionStorage
      sessionStorage.setItem(`meeting-settings-${newRoomId}`, JSON.stringify({
        joinMuted: settings.joinMuted,
        joinVideoOff: settings.joinVideoOff
      }));

      router.push(`/meeting/${newRoomId}`);
    } catch (error) {
      console.error("Failed to create meeting:", error);
      alert(dict.home.createError);
    } finally {
      setIsLoading(false);
      setIsModalOpen(false);
    }
  };

  const handleJoinMeeting = async () => {
    if (!meetingId) return;

    setIsLoading(true);
    try {
      const response = await fetch(`/api/meeting/validate?roomId=${meetingId}`);
      const data = await response.json();

      if (response.ok && data.valid) {
        router.push(`/meeting/${meetingId}`);
      } else {
        alert(dict.home.validationError);
      }
    } catch (error) {
      console.error("Failed to validate meeting:", error);
      alert(dict.home.validationErrorTitle);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background to-secondary/20 relative">
      <div className="absolute top-4 right-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full">
              <Globe className="w-5 h-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setLanguage('en')}>
              English {language === 'en' && '✓'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setLanguage('ko')}>
              한국어 {language === 'ko' && '✓'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Card className="w-full max-w-md shadow-xl border-border/50 backdrop-blur-sm bg-card/80">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-2">
            <span className="text-2xl">🎥</span>
          </div>
          <CardTitle className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-purple-600">
            {dict.home.title}
          </CardTitle>
          <CardDescription className="text-base">
            {dict.home.description}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Button
            className="w-full h-12 text-lg font-medium bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 shadow-lg shadow-blue-500/20 transition-all duration-300 hover:scale-[1.02]"
            onClick={handleCreateMeetingClick}
          >
            {dict.home.createButton}
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border/50" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">{dict.home.orJoin}</span>
            </div>
          </div>

          <div className="space-y-3">
            <Input
              type="text"
              placeholder={dict.home.joinPlaceholder}
              value={meetingId}
              onChange={(e) => setMeetingId(e.target.value)}
              className="h-12 text-center text-lg tracking-wider bg-secondary/50 border-border/50 focus:border-primary/50 transition-all"
            />
            <Button
              variant="secondary"
              className="w-full h-12 text-base font-medium hover:bg-secondary/80 transition-all"
              onClick={handleJoinMeeting}
              disabled={!meetingId}
            >
              {dict.home.joinButton}
            </Button>
          </div>
        </CardContent>
        <CardFooter className="text-center text-sm text-muted-foreground">
          <p className="w-full">
            {dict.home.footer}
            <br />
            <Link href="/login" className="text-primary hover:underline font-medium">
              {dict.home.signIn}
            </Link> {dict.home.forMore}
          </p>
        </CardFooter>
      </Card>

      <CreateMeetingModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onCreate={handleStartMeeting}
        isLoading={isLoading}
      />
    </div>
  );
}