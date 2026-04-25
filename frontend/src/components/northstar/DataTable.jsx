export function DataTable({ columns = [], rows = [], rowKey = "id", emptyMessage = "No rows available." }) {
  if (!rows.length) return <div className="ga-chart-empty">{emptyMessage}</div>;

  return (
    <div className="ga-data-table-wrap">
      <table className="ga-data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key || column.accessor}>{column.header || column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={row[rowKey] || row.fqn || row.name || rowIndex}>
              {columns.map((column) => {
                const key = column.key || column.accessor;
                const value = typeof column.render === "function"
                  ? column.render(row)
                  : row[column.accessor || key];
                return <td key={key}>{value ?? "Unavailable"}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default DataTable;
