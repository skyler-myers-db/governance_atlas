import { useEffect, useMemo, useState } from "react";
import {
  fetchAssetMetadataEditor,
  getAssetMetadataApiContract,
  updateAssetMetadata,
} from "../lib/api";

const EDITABLE_FIELD_KEYS = ["description", "domain", "tier", "certification", "sensitivity"];

function titleCase(value) {
  return value
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (char) => char.toUpperCase())
    .trim();
}

function fieldOptions(key, bootstrap, field) {
  if (Array.isArray(field?.options) && field.options.length) {
    return field.options.filter(Boolean);
  }

  const discovery = bootstrap?.discovery || {};
  if (key === "domain") return (discovery.domains || []).filter((value) => value && value !== "All domains");
  if (key === "tier") return (discovery.tiers || []).filter((value) => value && value !== "All tiers");
  if (key === "certification") {
    return (discovery.certifications || []).filter(
      (value) => value && value !== "All certifications",
    );
  }
  if (key === "sensitivity") {
    return (discovery.sensitivities || []).filter(
      (value) => value && value !== "All sensitivities",
    );
  }
  return [];
}

function normalizeField(field, bootstrap) {
  const key = field?.key || field?.name;
  if (!EDITABLE_FIELD_KEYS.includes(key)) return null;
  const options = fieldOptions(key, bootstrap, field);
  const requestedType = (field?.type || field?.kind || (key === "description" ? "textarea" : "select"))
    .toString()
    .toLowerCase();
  const resolvedType =
    key === "description"
      ? "textarea"
      : requestedType === "text"
        ? "text"
        : options.length
          ? "select"
          : "text";
  const defaultHelpText =
    key !== "description" && !options.length
      ? `No preset ${titleCase(key).toLowerCase()} options are configured yet. Type a value to save it directly on this asset.`
      : "";

  return {
    key,
    label: field?.label || titleCase(key),
    type: resolvedType,
    placeholder:
      field?.placeholder ||
      (key === "description"
        ? "Add a description for this asset"
        : resolvedType === "text"
          ? `Enter ${titleCase(key).toLowerCase()}`
          : `Select ${titleCase(key).toLowerCase()}`),
    helpText: field?.helpText || field?.description || defaultHelpText,
    options,
  };
}

function normalizeConfig(config, bootstrap) {
  if (!config || typeof config !== "object") return null;

  const definedFields = Array.isArray(config.fields) ? config.fields : [];
  const fields = (definedFields.length ? definedFields : EDITABLE_FIELD_KEYS.map((key) => ({ key })))
    .map((field) => normalizeField(field, bootstrap))
    .filter(Boolean);

  return {
    available: config.available !== false,
    endpoint: config.endpoint || config.path || config.url || "",
    updatePath: config.updatePath || config.savePath || config.endpoint || config.path || config.url || "",
    updateMethod: (config.updateMethod || config.method || "PATCH").toString().toUpperCase(),
    fields,
    message: config.message || config.note || "",
  };
}

function inlineEditorConfig(asset) {
  return (
    asset?.metadataEditor ||
    asset?.metadataEdit ||
    asset?.editableMetadata ||
    asset?.metadataEditing ||
    null
  );
}

export function useAssetMetadataEditor({ assetFqn, asset, bootstrap }) {
  const [state, setState] = useState({
    loading: false,
    error: "",
    available: false,
    config: null,
    submitting: false,
    submitError: "",
    submitSuccess: "",
  });

  const contract = useMemo(() => getAssetMetadataApiContract(assetFqn), [assetFqn]);
  const localConfig = useMemo(
    () => normalizeConfig(inlineEditorConfig(asset), bootstrap),
    [asset, bootstrap],
  );

  useEffect(() => {
    if (!assetFqn) {
      setState({
        loading: false,
        error: "",
        available: false,
        config: null,
        submitting: false,
        submitError: "",
        submitSuccess: "",
      });
      return;
    }

    if (localConfig) {
      setState({
        loading: false,
        error: "",
        available: localConfig.available,
        config: localConfig,
        submitting: false,
        submitError: "",
        submitSuccess: "",
      });
      return;
    }

    if (!contract.available) {
      setState({
        loading: false,
        error: "",
        available: false,
        config: null,
        submitting: false,
        submitError: "",
        submitSuccess: "",
      });
      return;
    }

    let canceled = false;
    setState((current) => ({
      ...current,
      loading: true,
      error: "",
      submitError: "",
      submitSuccess: "",
    }));

    fetchAssetMetadataEditor(assetFqn)
      .then((remoteConfig) => {
        if (canceled) return;
        const normalized = normalizeConfig(remoteConfig, bootstrap);
        setState({
          loading: false,
          error: "",
          available: normalized?.available || false,
          config: normalized,
          submitting: false,
          submitError: "",
          submitSuccess: "",
        });
      })
      .catch((error) => {
        if (canceled) return;
        setState({
          loading: false,
          error: error?.message || "Failed to inspect metadata editing capabilities.",
          available: false,
          config: null,
          submitting: false,
          submitError: "",
          submitSuccess: "",
        });
      });

    return () => {
      canceled = true;
    };
  }, [assetFqn, bootstrap, contract.available, localConfig]);

  const save = async (payload) => {
    setState((current) => ({
      ...current,
      submitting: true,
      submitError: "",
      submitSuccess: "",
    }));
    try {
      const response = await updateAssetMetadata(assetFqn, payload, state.config || {});
      setState((current) => ({
        ...current,
        submitting: false,
        submitError: "",
        submitSuccess: "Metadata saved.",
      }));
      return response;
    } catch (error) {
      setState((current) => ({
        ...current,
        submitting: false,
        submitError: error?.message || "Failed to save metadata.",
        submitSuccess: "",
      }));
      throw error;
    }
  };

  return {
    loading: state.loading,
    error: state.error,
    available: state.available,
    config: state.config,
    submitting: state.submitting,
    submitError: state.submitError,
    submitSuccess: state.submitSuccess,
    hasContract: contract.available,
    save,
  };
}
