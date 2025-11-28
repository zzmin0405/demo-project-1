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
            <DialogContent className="sm:max-w-[500px] border-border/50 bg-background/95 backdrop-blur-xl shadow-2xl">
                <DialogHeader>
                    <DialogTitle className="text-2xl font-bold bg-gradient-to-r from-primary to-purple-500 bg-clip-text text-transparent">
                        {dict.modal.title}
                    </DialogTitle>
                    <DialogDescription>
                        {dict.modal.description}
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-6 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="title" className="text-sm font-medium text-muted-foreground">
                            {dict.modal.topicLabel}
                        </Label>
                        <Input
                            id="title"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder={dict.modal.topicPlaceholder}
                            className="bg-secondary/50 border-border/50 focus:border-primary/50 transition-all"
                        />
                    </div>

                    <div className="space-y-4">
                        <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                            <Settings2 className="w-4 h-4" /> {dict.modal.optionsTitle}
                        </h4>

                        <div className="grid gap-4 p-4 rounded-xl bg-secondary/30 border border-border/50">
                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <Label className="text-base flex items-center gap-2">
                                        <MessageSquare className="w-4 h-4 text-blue-400" /> {dict.modal.saveChat}
                                    </Label>
                                    <p className="text-xs text-muted-foreground">
                                        {dict.modal.saveChatDesc}
                                    </p>
                                </div>
                                <Switch checked={isChatSaved} onCheckedChange={setIsChatSaved} />
                            </div>

                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <Label className="text-base flex items-center gap-2">
                                        <Mic className="w-4 h-4 text-red-400" /> {dict.modal.muteEntry}
                                    </Label>
                                    <p className="text-xs text-muted-foreground">
                                        {dict.modal.muteEntryDesc}
                                    </p>
                                </div>
                                <Switch checked={joinMuted} onCheckedChange={setJoinMuted} />
                            </div>

                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <Label className="text-base flex items-center gap-2">
                                        <Video className="w-4 h-4 text-purple-400" /> {dict.modal.videoOffEntry}
                                    </Label>
                                    <p className="text-xs text-muted-foreground">
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
