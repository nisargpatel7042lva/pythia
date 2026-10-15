"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="card mx-auto mt-16 max-w-lg p-8 text-center">
      <h1 className="heading mb-2 text-3xl">Something went wrong</h1>
      <p className="mb-6 text-sm text-fog">This page hit an unexpected problem. Your funds and bets are unaffected.</p>
      <button className="btn-primary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
