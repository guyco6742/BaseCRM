// src/components/Pagination.jsx
// פקדי עימוד גנריים RTL: הקודם/הבא, "עמוד X מתוך Y", מונה רשומות וגודל עמוד.
// שימוש חוזר לכל רשימה מעומדת בצד שרת (usePagedQuery) — לקוחות כרגע, ובעתיד
// לוג-פעולות/דוחות-קידוח (§8 "Pagination infra" בספק).
import { PAGE_SIZE_OPTIONS } from '../hooks/usePagedQuery'

export default function Pagination({ page, setPage, pageSize, setPageSize, total }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = page + 1 // תצוגה 1-based

  return (
    <div
      className="mt-4 flex flex-wrap items-center justify-between gap-3"
      data-testid="clients-pagination"
    >
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-dim"
        data-testid="pagination-info"
      >
        <span>{total.toLocaleString('he')} רשומות</span>
        <span>
          עמוד {currentPage} מתוך {totalPages}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-sm text-text-dim">
          <span>שורות בעמוד</span>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            aria-label="שורות בעמוד"
            className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-text outline-none focus:border-accent"
            data-testid="pagination-size"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => setPage(page - 1)}
          disabled={page <= 0}
          aria-label="עמוד קודם"
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text-muted hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
          data-testid="pagination-prev"
        >
          הקודם
        </button>
        <button
          type="button"
          onClick={() => setPage(page + 1)}
          disabled={currentPage >= totalPages}
          aria-label="עמוד הבא"
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text-muted hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
          data-testid="pagination-next"
        >
          הבא
        </button>
      </div>
    </div>
  )
}
