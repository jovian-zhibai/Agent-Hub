"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
      <div className="text-4xl">😵</div>
      <h2 className="text-lg font-semibold text-slate-200">出了点问题</h2>
      <p className="text-sm text-slate-400 max-w-md text-center">
        {error.message || "页面加载失败，请重试"}
      </p>
      <button
        onClick={reset}
        className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors text-sm"
      >
        重试
      </button>
    </div>
  );
}