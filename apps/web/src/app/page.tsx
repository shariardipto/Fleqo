
export default async function Home() {
  let apiStatus = "Offline";

  try {
    const response = await fetch(
      "http://localhost:4000/api/health",
      {
        cache: "no-store",
      }
    );

    if (response.ok) {
      const data = await response.json();

      if (data.success === true) {
        apiStatus = "Online";
      }
    }
  } catch (error) {
    console.error("Backend connection failed:", error);
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-950 text-white">
      <h1 className="text-5xl font-bold">
        Fleqo
      </h1>

      <p className="mt-3 text-slate-400">
        Workflow Automation Platform
      </p>

      <div className="mt-8 rounded-xl border border-slate-700 p-6">
        <h2 className="text-xl font-semibold">
          System Status
        </h2>

        <p className="mt-3">
          Backend API:{" "}
          <span
            className={
              apiStatus === "Online"
                ? "text-green-400"
                : "text-red-400"
            }
          >
            {apiStatus}
          </span>
        </p>
      </div>
    </main>
  );
}
