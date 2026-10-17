import { Frame } from "@/components/Nav";

/** Standard page head: mono tag, huge display title, optional sub text and right-hand slot. */
export function PageHead({ tag, title, sub, right }: { tag: string; title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <Frame>
      <div className="flex flex-col justify-between gap-6 border-b border-line p-6 sm:p-10 md:flex-row md:items-end">
        <div>
          <p className="tag mb-5 flex items-center gap-2 text-sage">
            <span className="h-2 w-2 bg-sage" /> {tag}
          </p>
          <h1 className="display text-[clamp(38px,4.8vw,76px)]">{title}</h1>
          {sub && <p className="mt-5 max-w-xl text-fog">{sub}</p>}
        </div>
        {right}
      </div>
    </Frame>
  );
}
