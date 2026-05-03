import { ResumeBanner } from "@/components/upload/ResumeBanner";
import { UploadDropzone } from "@/components/upload/UploadDropzone";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-8 px-6 py-12">
      <div className="space-y-3 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">
          AI Proposal Editor
        </h1>
        <p className="text-muted-foreground max-w-xl text-base">
          Upload a proposal PDF; edit it block-by-block with AI grounded in
          your past work; review every change before applying it.
        </p>
      </div>

      <div className="w-full space-y-4">
        <ResumeBanner />
        <UploadDropzone />
      </div>

      <p className="text-muted-foreground/80 text-xs">
        Supports PDFs up to 32 MB · all processing happens through your
        organization&apos;s AI proxy
      </p>
    </main>
  );
}
