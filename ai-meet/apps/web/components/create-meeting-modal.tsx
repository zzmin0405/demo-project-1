"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Video, Mic, MessageSquare, Settings2 } from "lucide-react"
import { useLanguage } from "@/contexts/language-context"

interface CreateMeetingModalProps {
    isOpen: boolean
    onClose: () => void
    onCreate: (settings: MeetingSettings) => void
    isLoading?: boolean
}

export interface MeetingSettings {
    title: string
    isChatSaved: boolean
    joinMuted: boolean
    joinVideoOff: boolean
}

export function CreateMeetingModal({ isOpen, onClose, onCreate, isLoading }: CreateMeetingModalProps) {
    const [title, setTitle] = useState("")
    const [isChatSaved, setIsChatSaved] = useState(true)
    const [joinMuted, setJoinMuted] = useState(false)
    const [joinVideoOff, setJoinVideoOff] = useState(false)
    const { dict } = useLanguage();

    const handleCreate = () => {
        onCreate({
            title: title.trim() || "Untitled Meeting",
            isChatSaved,
            joinMuted,
            joinVideoOff
        })
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[600px] border-border/50 bg-background/95 backdrop-blur-xl shadow-2xl">
                <DialogHeader>
                    <DialogTitle className="text-2xl font-bold bg-gradient-to-r from-primary to-purple-500 bg-clip-text text-transparent">
                        {dict.modal.title}
                    </DialogTitle>
                    <DialogDescription>
                        {dict.modal.description}
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-8 py-6">
                    <div className="grid gap-3">
                        <Label htmlFor="title" className="text-sm font-medium text-muted-foreground">
                            {dict.modal.topicLabel}
                        </Label>
                        <Input
                            id="title"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder={dict.modal.topicPlaceholder}
                            className="bg-secondary/50 border-border/50 focus:border-primary/50 transition-all h-11"
                        />
                    </div>

                    <div className="space-y-5">
                        <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                            <Settings2 className="w-4 h-4" /> {dict.modal.optionsTitle}
                        </h4>

                        <div className="grid gap-10 p-12 rounded-3xl bg-secondary/40 border border-border/50 shadow-inner">
                            <div className="flex items-center justify-between gap-8">
                                <div className="space-y-1">
                                    <Label className="text-lg flex items-center gap-3">
                                        <MessageSquare className="w-5 h-5 text-blue-400" /> {dict.modal.saveChat}
                                    </Label>
                                    <p className="text-sm text-muted-foreground">
                                        {dict.modal.saveChatDesc}
                                    </p>
                                </div>
                                <Switch checked={isChatSaved} onCheckedChange={setIsChatSaved} />
                            </div>

                            <div className="flex items-center justify-between gap-8">
                                <div className="space-y-1">
                                    <Label className="text-lg flex items-center gap-3">
                                        <Mic className="w-5 h-5 text-red-400" /> {dict.modal.muteEntry}
                                    </Label>
                                    <p className="text-sm text-muted-foreground">
                                        {dict.modal.muteEntryDesc}
                                    </p>
                                </div>
                                <Switch checked={joinMuted} onCheckedChange={setJoinMuted} />
                            </div>

                            <div className="flex items-center justify-between gap-8">
                                <div className="space-y-1">
                                    <Label className="text-lg flex items-center gap-3">
                                        <Video className="w-5 h-5 text-purple-400" /> {dict.modal.videoOffEntry}
                                    </Label>
                                    <p className="text-sm text-muted-foreground">
                                        {dict.modal.videoOffEntryDesc}
                                    </p>
                                </div>
                                <Switch checked={joinVideoOff} onCheckedChange={setJoinVideoOff} />
                            </div>
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={onClose} disabled={isLoading}>
                        {dict.modal.cancel}
                    </Button>
                    <Button
                        onClick={handleCreate}
                        disabled={isLoading}
                        className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white shadow-lg shadow-blue-500/20 transition-all duration-300"
                    >
                        {isLoading ? dict.modal.creating : dict.modal.start}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
