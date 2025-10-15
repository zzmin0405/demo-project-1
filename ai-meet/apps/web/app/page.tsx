import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import Link from "next/link";

export default function Home() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">AI Meet</CardTitle>
          <CardDescription>Create or join a meeting instantly.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button className="w-full">Create New Meeting</Button>
          <div className="flex items-center space-x-2">
            <hr className="flex-grow" />
            <span className="text-muted-foreground text-sm">OR</span>
            <hr className="flex-grow" />
          </div>
          <div className="space-y-2">
            <Input type="text" placeholder="Enter Meeting ID" />
            <Button variant="secondary" className="w-full">Join Meeting</Button>
          </div>
        </CardContent>
        <CardFooter className="text-center text-sm">
          <p className="w-full">
            Want to log in?{" "}
            <Link href="/login" className="text-primary hover:underline">
              Login here
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}