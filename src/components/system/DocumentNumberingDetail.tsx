'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { App, Button, Checkbox, Form, Input, InputNumber, Select, Tabs } from 'antd';
import { SaveOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import type { ColDef } from 'ag-grid-community';
import { useRouter } from 'next/navigation';
import { documentNumberingAPI, documentTypesAPI } from '@/lib/apiClient';
import { useCanChange } from '@/stores/accessStore';
import { DetailView, ReadOnlyText, detailFormProps } from '@/components/ui/DetailView';
import { DataGrid } from '@/components/ui/DataGrid';
import type { DateNumbering, DocumentType, NumberingSeriesDetail as SeriesDetail } from '@/types';

interface DocumentNumberingDetailProps {
  /** Omit to create a new series */
  docEntry?: number;
  /** Open an existing series directly in edit mode (list view's Edit button) */
  startInEdit?: boolean;
}

interface SeriesFormValues {
  objType: string;
  series: string;
  seriesName: string;
  prefix: string;
  seq: number;
  length: number;
  suffix: string;
  month: boolean;
  year: boolean;
  isDefault: boolean;
  active: boolean;
  isManual: boolean;
}

/** No manual series: Sales Check In is numbered on check in (no Confirm); Convert to Customer's No. is its SAP BP Code */
const NO_MANUAL_OBJTYPES = ['FTS11SCIN', 'FTS11OCRD'];

const toFormValues = (series: SeriesDetail): SeriesFormValues => ({
  objType: series.objType,
  series: series.series,
  seriesName: series.seriesName ?? '',
  prefix: series.prefix ?? '',
  seq: series.seq,
  length: series.length,
  suffix: series.suffix ?? '',
  month: series.month,
  year: series.year,
  isDefault: series.isDefault,
  active: series.active,
  isManual: series.isManual,
});

/** Copies, so cancelling an edit made in the grid leaves the loaded rows untouched */
const copyDates = (dates: DateNumbering[]) => dates.map((d) => ({ ...d }));

/** View-mode Doc. Object Type: shows the name for the stored code (Form.Item passes the code as `value`) */
function DocumentName({ value, documentTypes }: { value?: string; documentTypes: DocumentType[] }) {
  const name = documentTypes.find((d) => d.code === value)?.name;
  return <ReadOnlyText value={name ?? value} />;
}

/**
 * Detail view of a document numbering series (FTS11NNM1) and its Date Numbering (FTS11NNM2).
 * Existing series open in view mode.
 */
export default function DocumentNumberingDetail({ docEntry, startInEdit = false }: DocumentNumberingDetailProps) {
  const isNew = docEntry === undefined;
  const { message } = App.useApp();
  // Read Only screen (the user's roles): no New / Edit
  const canChange = useCanChange();
  const router = useRouter();
  const [series, setSeries] = useState<SeriesDetail | null>(null);
  const [dates, setDates] = useState<DateNumbering[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  // Detail views open in view mode; Edit switches to edit mode
  const [editing, setEditing] = useState(isNew || startInEdit);
  const [documentTypes, setDocumentTypes] = useState<DocumentType[]>([]);
  const [form] = Form.useForm<SeriesFormValues>();
  // Manual: the No. is keyed in on Confirm, so Prefix / Seq / Length / Suffix / Month / Year don't apply
  const isManual = !!Form.useWatch('isManual', form);
  const objType = Form.useWatch('objType', form);
  const manualAllowed = !NO_MANUAL_OBJTYPES.includes(objType ?? '');

  // Choices for the Doc. Object Type drop-down (FTS_vw_ObjType)
  useEffect(() => {
    documentTypesAPI
      .getList()
      .then((res) => res.success && setDocumentTypes(res.data))
      .catch(() => message.error('Failed to load document types'));
  }, []);

  useEffect(() => {
    if (isNew) return;
    const load = async () => {
      try {
        const res = await documentNumberingAPI.getById(docEntry);
        if (res.success) {
          setSeries(res.data);
          setDates(copyDates(res.data.dates));
        }
      } catch {
        message.error('Failed to load document numbering');
        router.push('/system/document-numbering');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [docEntry]);

  // Fill the form once it is on screen (it isn't rendered while loading)
  useEffect(() => {
    if (!loading && series) form.setFieldsValue(toFormValues(series));
  }, [loading]);

  // Date Numbering: Seq can be changed in the row in edit mode; rows are added when documents are numbered
  const dateColumns = useMemo<ColDef<DateNumbering>[]>(
    () => [
      { field: 'year', headerName: 'Year', sort: 'asc', cellDataType: 'number' },
      // Rows come in Year, Month order; only Year carries a sort so the headers don't show sort numbers ("Year 1", "Month 2")
      { field: 'month', headerName: 'Month', cellDataType: 'number' },
      {
        field: 'seq',
        headerName: 'Seq',
        cellDataType: 'number',
        editable: editing,
        cellEditor: 'agNumberCellEditor',
        cellEditorParams: { min: 1, precision: 0 },
      },
    ],
    [editing]
  );

  const handleCancelEdit = () => {
    if (isNew) {
      router.push('/system/document-numbering');
      return;
    }
    // Discard unsaved changes, including Seq typed in the Date Numbering grid
    form.resetFields();
    if (series) {
      form.setFieldsValue(toFormValues(series));
      setDates(copyDates(series.dates));
    }
    setEditing(false);
  };

  const handleSave = async (values: SeriesFormValues) => {
    if (!editing) return;
    if (dates.some((d) => !Number.isInteger(d.seq) || d.seq < 1)) {
      message.error('Date Numbering Seq must be a whole number of 1 or more');
      return;
    }

    const payload = {
      objType: values.objType,
      series: values.series,
      seriesName: values.seriesName || null,
      prefix: values.prefix || null,
      seq: values.seq,
      length: values.length,
      suffix: values.suffix || null,
      month: !!values.month,
      year: !!values.year,
      isDefault: !!values.isDefault,
      active: !!values.active,
      isManual: !!values.isManual && manualAllowed,
      dates: dates.map((d) => ({ year: d.year, month: d.month, seq: d.seq })),
    };

    setSaving(true);
    try {
      if (isNew) {
        const res = await documentNumberingAPI.create(payload);
        if (res.success) {
          message.success('Document numbering created');
          router.replace(`/system/document-numbering/${res.data.docEntry}`);
        }
      } else {
        const res = await documentNumberingAPI.update(docEntry, payload);
        if (res.success) {
          message.success('Document numbering updated');
          setSeries(res.data);
          setDates(copyDates(res.data.dates));
          form.setFieldsValue(toFormValues(res.data));
          setEditing(false);
        }
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      message.error(err.response?.data?.error || 'Failed to save document numbering');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    // The portal's own loading overlay (LOADING... bar) shows while the data is fetched; nothing else is drawn meanwhile
    return null;
  }

  if (!isNew && !series) return null;

  // Button order: New, Edit, then the rest
  const toolbar = editing ? (
    <>
      <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => form.submit()}>
        Save
      </Button>
      <Button disabled={saving} onClick={handleCancelEdit}>Cancel</Button>
    </>
  ) : !canChange ? null : (
    <>
      <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push('/system/document-numbering/new')}>
        New
      </Button>
      <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
        Edit
      </Button>
    </>
  );

  const text = (max: number, off = false) => (editing ? <Input maxLength={max} disabled={off} /> : <ReadOnlyText />);
  const wholeNumber = (min: number, max?: number, off = false) =>
    editing ? <InputNumber min={min} max={max} precision={0} disabled={off} /> : <ReadOnlyText />;

  return (
    <Form
      form={form}
      {...detailFormProps(editing)}
      initialValues={{ seq: 1, length: 4, month: false, year: false, isDefault: false, active: true, isManual: false }}
      onFinish={handleSave}
    >
      <DetailView
        toolbar={toolbar}
        title={`Document Numbering - ${isNew ? 'New' : series?.series}`}
        // Checkboxes in a column on the right, each with its name after the box
        sideFields={
          <>
            {/* Manual: the user keys in the No. on Confirm (up to 15 characters); no prefix / numbering by date */}
            <Form.Item name="isManual" valuePropName="checked">
              <Checkbox
                disabled={!editing || !manualAllowed}
                onChange={(e) => e.target.checked && form.setFieldsValue({ month: false, year: false })}
              >
                Manual
              </Checkbox>
            </Form.Item>
            <Form.Item name="month" valuePropName="checked">
              {/* Numbering by month restarts in every month of every year, so it ticks Year too */}
              <Checkbox
                disabled={!editing || isManual}
                onChange={(e) => e.target.checked && form.setFieldsValue({ year: true })}
              >
                Month
              </Checkbox>
            </Form.Item>
            <Form.Item name="year" valuePropName="checked">
              <Checkbox
                disabled={!editing || isManual}
                onChange={(e) => !e.target.checked && form.setFieldsValue({ month: false })}
              >
                Year
              </Checkbox>
            </Form.Item>
            <Form.Item name="isDefault" valuePropName="checked">
              <Checkbox disabled={!editing}>Default</Checkbox>
            </Form.Item>
            <Form.Item name="active" valuePropName="checked">
              <Checkbox disabled={!editing}>Active</Checkbox>
            </Form.Item>
          </>
        }
        below={
          <Tabs
            type="card"
            items={[
              {
                key: 'dates',
                label: 'Date Numbering',
                children: (
                  <DataGrid<DateNumbering>
                    settingsKey="document-numbering:dates"
                    showToolbar
                    exportFileName="Date Numbering"
                    gridProps={{
                      rowData: dates,
                      columnDefs: dateColumns,
                      getRowId: (p) => `${p.data.year}-${p.data.month}`,
                      // Cells take focus so Tab / Enter move between the values being typed
                      suppressCellFocus: false,
                      singleClickEdit: true,
                      stopEditingWhenCellsLoseFocus: true,
                      onCellValueChanged: () => setDates((prev) => [...prev]),
                    }}
                  />
                ),
              },
            ]}
          />
        }
      >
        <Form.Item
          label="Doc. Object Type"
          name="objType"
          rules={[{ required: true, message: 'Doc. Object Type is required' }]}
        >
          {editing ? (
            <Select
              placeholder="Select a document"
              options={documentTypes.map((d) => ({ value: d.code, label: d.name }))}
            />
          ) : (
            <DocumentName documentTypes={documentTypes} />
          )}
        </Form.Item>
        <Form.Item
          label="Series"
          name="series"
          rules={[{ required: true, whitespace: true, message: 'Series is required' }]}
        >
          {text(100)}
        </Form.Item>
        <Form.Item label="Series Name" name="seriesName">
          {text(100)}
        </Form.Item>
        {/* [YY], [YYYY] and [MM] are replaced by the document date, e.g. CN[YY][MM] */}
        <Form.Item label="Prefix" name="prefix">
          {text(50, isManual)}
        </Form.Item>
        <Form.Item label="Seq" name="seq" rules={[{ required: true, message: 'Seq is required' }]}>
          {wholeNumber(1, undefined, isManual)}
        </Form.Item>
        <Form.Item label="Length" name="length" rules={[{ required: true, message: 'Length is required' }]}>
          {wholeNumber(1, 20, isManual)}
        </Form.Item>
        <Form.Item label="Suffix" name="suffix">
          {text(50, isManual)}
        </Form.Item>
      </DetailView>
    </Form>
  );
}
