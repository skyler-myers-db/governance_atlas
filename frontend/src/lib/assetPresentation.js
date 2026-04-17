function normalizedLabel(value) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized === "—") return "";
  if (normalized.toLowerCase().startsWith("unknown")) return "";
  return normalized;
}

function normalizedObjectTypeToken(value) {
  return normalizedLabel(value).toUpperCase().replace(/_/g, " ");
}

export function displayObjectType(asset) {
  const objectType = normalizedLabel(asset?.objectType);
  const rawType = normalizedObjectTypeToken(asset?.tableTypeRaw);
  const objectTypeToken = normalizedObjectTypeToken(asset?.objectType);
  const rawFormat = normalizedLabel(asset?.storageFormat || asset?.format).toUpperCase();
  const genericTableLike =
    !rawType ||
    ["TABLE", "BASE TABLE", "MANAGED", "MANAGED TABLE", "EXTERNAL", "EXTERNAL TABLE"].includes(rawType);
  const objectTypeLooksGeneric = !objectTypeToken || ["TABLE", "DELTA TABLE"].includes(objectTypeToken);

  if (rawFormat === "DELTA" && genericTableLike && objectTypeLooksGeneric) {
    return "Delta Table";
  }
  if (rawType === "STREAMING TABLE") return "Streaming Table";
  if (rawType === "MATERIALIZED VIEW") return "Materialized View";
  if (rawType === "VIEW") return "View";
  if (objectTypeToken === "STREAMING TABLE") return "Streaming Table";
  if (objectTypeToken === "MATERIALIZED VIEW") return "Materialized View";
  if (objectTypeToken === "VIEW") return "View";
  if (objectType) return objectType;
  if (rawType) return normalizedLabel(asset?.tableTypeRaw).replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
  return "";
}

export function displayStorageFormat(asset) {
  const storageFormat = normalizedLabel(asset?.storageFormat || asset?.format);
  if (!storageFormat) return "—";
  const mapping = {
    delta: "Delta",
    parquet: "Parquet",
    csv: "CSV",
    json: "JSON",
    avro: "Avro",
    orc: "ORC",
    iceberg: "Iceberg",
    text: "Text",
  };
  return mapping[storageFormat.toLowerCase()] || storageFormat;
}

export function displayManagementType(asset) {
  const managementType = normalizedLabel(asset?.managementType);
  if (!managementType) return "—";
  return managementType;
}

export function assetPathLabel(asset, includeType = false) {
  if (!asset) return "";
  const parts = [asset.catalog, asset.schema].filter(Boolean);
  const path = parts.join(" / ");
  if (!includeType) return path;
  const objectType = displayObjectType(asset);
  return [path, objectType].filter(Boolean).join(" · ");
}
