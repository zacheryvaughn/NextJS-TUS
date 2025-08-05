import TusFileUpload from "@/components/upload/TusFileUpload";

export default function Home() {
  return (
      <main className="min-h-screen min-w-screen flex flex-col items-center justify-center">
        {/* File Upload Component */}
        <TusFileUpload />
      </main>
  );
}
