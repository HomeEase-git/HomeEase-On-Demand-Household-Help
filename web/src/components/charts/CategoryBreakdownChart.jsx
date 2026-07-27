import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList, ResponsiveContainer } from 'recharts'

const PALETTE = ['#2563eb', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444']

export default function CategoryBreakdownChart({ data }) {
  if (!data || data.length === 0) {
    return <div className="chart-placeholder">No booking activity yet</div>
  }

  const chartData = data.map((d) => ({ category: d.category, count: d.count }))

  return (
    <div style={{ width: '100%', height: 240 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="category" tick={{ fontSize: 12, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} width={28} />
          <Tooltip
            contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13 }}
            labelStyle={{ color: 'var(--text)' }}
          />
          <Bar dataKey="count" name="Bookings" radius={[6, 6, 0, 0]}>
            <LabelList dataKey="count" position="top" style={{ fill: 'var(--text-muted)', fontSize: 12 }} />
            {chartData.map((entry, index) => (
              <Cell key={entry.category} fill={PALETTE[index % PALETTE.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
