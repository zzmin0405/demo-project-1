"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useState, useEffect } from "react"
import { Settings2 } from "lucide-react"

interface SettingsModalProps {
    isOpen: boolean
    onClose: () => void
    currentTitle: string
    onTitleChange: (newTitle: string) => void
    isHost: boolean
}

export function SettingsModal({ isOpen, onClose, currentTitle, onTitleChange, isHost }: SettingsModalProps) {
    const [title, setTitle] = useState(currentTitle)

    useEffect(() => {
        setTitle(currentTitle)
    }, [currentTitle])

    const handleSave = () => {
        if (isHost && title.trim() !== currentTitle) {
            onTitleChange(title)
        }
        onClose()
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Settings2 className="w-5 h-5" /> Meeting Settings
                    </DialogTitle>
                    <DialogDescription>
                        Manage your meeting preferences.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-6 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="meeting-title">Meeting Title</Label>
                        <Input
                            id="meeting-title"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            disabled={!isHost}
                            className="h-10"
                        />
                        {!isHost && (
                            <p className="text-xs text-muted-foreground">
                                Only the host can edit the meeting title.
                            </p>
                        )}
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                    <Button onClick={handleSave} disabled={!isHost && title === currentTitle}>
                        Save Changes
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
