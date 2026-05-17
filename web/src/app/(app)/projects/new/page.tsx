import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import NewProjectForm from "./new-project-form";

export default async function NewProjectPage() {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }
  const [user, gc] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { canSelfCreateProject: true },
    }),
    prisma.globalConfig.findUnique({ where: { key: "allow_user_self_create_project" } }),
  ]);
  const allowed = !!(user?.canSelfCreateProject || gc?.value === "true");
  if (!allowed) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>无自建项目权限</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              v1.9.0 起，新用户默认不可自建 Project。请联系管理员将你加入项目组（Series）。
            </p>
            <div className="flex gap-2">
              <Link href="/series">
                <Button>前往我的项目</Button>
              </Link>
              <Link href="/dashboard">
                <Button variant="outline">返回工作台</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }
  return <NewProjectForm />;
}
