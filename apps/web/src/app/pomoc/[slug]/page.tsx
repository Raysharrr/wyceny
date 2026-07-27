import { notFound, redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { HELP_PAGES, getPage } from "@/content/pomoc/manifest";

export const generateStaticParams = async () => HELP_PAGES.map(({ slug }) => ({ slug }));

/**
 * Renderer for every help page (Slice 13, Task 2). The manifest is the single
 * source of both the route set and the content module.
 *
 * The session gate is repeated here on purpose: `AppShellLayout` only decides
 * whether to draw the Topbar, it does not block access. Without this check the
 * whole of Pomoc would be readable signed out.
 */
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const { slug } = await params;
  const page = getPage(slug);
  if (!page) {
    notFound();
  }

  const { default: Content } = await page.load();
  return (
    <main className="mx-auto max-w-[1100px] px-6 py-8">
      <h1 className="mb-6 text-[25px] font-semibold tracking-[-0.015em]">{page.title}</h1>
      <article>
        <Content />
      </article>
    </main>
  );
}
