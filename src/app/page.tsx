import UploadForm from "@/components/UploadForm";

const MAX_UPLOAD_MB = Number.parseInt(process.env.MAX_UPLOAD_MB ?? "5", 10);

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col px-6 pb-20 pt-20 sm:pt-28">
      <section className="mb-12 sm:mb-14">
        <h1 className="text-balance text-4xl font-medium leading-[1.05] tracking-tight text-white sm:text-5xl">
          Turn study notes into audiobooks
        </h1>

        <p className="mt-5 max-w-lg text-balance text-base leading-relaxed text-white/55 sm:text-lg">
          Upload a TXT, DOCX, or Markdown file and convert it into clear
          narrated audio you can preview and download.
        </p>
      </section>

      <UploadForm maxUploadMb={MAX_UPLOAD_MB} />
    </main>
  );
}
