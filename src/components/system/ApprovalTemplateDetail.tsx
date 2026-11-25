'use client';

import React, { useState, useEffect, useRef } from 'react';
import { App, Button, Checkbox, Form, Input, Select } from 'antd';
import { SaveOutlined, EditOutlined, PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';
import type { ColDef } from 'ag-grid-community';
import { useRouter } from 'next/navigation';
import { approvalStagesAPI, approvalTemplatesAPI, documentTypesAPI } from '@/lib/apiClient';
import { useCanChange } from '@/stores/accessStore';
import { DetailView, ReadOnlyText, detailFormProps } from '@/components/ui/DetailView';
import { DataGrid } from '@/components/ui/DataGrid';
import type { DataGridHandle } from '@/components/ui/DataGrid';
import { LookupListView } from '@/components/ui/LookupListView';
import type {
  ApprovalStage,
  ApprovalTemplateDetail as TemplateDetail,
  ApprovalTemplateStage,
  DocumentType,
} from '@/types';

interface ApprovalTemplateDetailProps {
  /** Omit to create a new template */
  docEntry?: number;
  /** Open an existing template directly in edit mode (list view's Edit button) */
  startInEdit?: boolean;
}

interface TemplateFormValues {
  wtmCode: string;
  wtmName: string;
  objDoc: string;
  active: boolean;
  query: string;
}

const toFormValues = (template: TemplateDetail): TemplateFormValues => ({
  wtmCode: template.wtmCode,
  wtmName: template.wtmName,
  objDoc: template.objDoc,
  active: template.active,
  query: template.query,
});

// Stages are approved in the order they were assigned: Stage No. 1 first
const stageColumns: ColDef<ApprovalTemplateStage>[] = [
  { field: 'stageNo', headerName: 'Stage No.', cellDataType: 'number', sort: 'asc' },
  { field: 'wstName', headerName: 'Approval Stage', flex: 1 },
];

/** Stage No. = position in the list (1, 2, 3 ...), so it follows adding / removing stages */
const numberStages = (stages: ApprovalTemplateStage[]) => stages.map((s, i) => ({ ...s, stageNo: i + 1 }));

const stageLookupColumns: ColDef<ApprovalStage>[] = [
  { field: 'wstCode', headerName: 'Stage Code', width: 200, sort: 'asc' },
  { field: 'wstName', headerName: 'Description', flex: 1, minWidth: 200 },
];

/** View-mode Document: shows the name for the stored code (Form.Item passes the code as `value`) */
function DocumentName({ value, documentTypes }: { value?: string; documentTypes: DocumentType[] }) {
  const name = documentTypes.find((d) => d.code === value)?.name;
  return <ReadOnlyText value={name ?? value} />;
}

const loadStages = async (): Promise<ApprovalStage[]> => {
  const res = await approvalStagesAPI.getList();
  return res.success ? res.data : [];
};

/** Detail view of an approval template and its approval stages. Existing templates open in view mode. */
export default function ApprovalTemplateDetail({ docEntry, startInEdit = false }: ApprovalTemplateDetailProps) {
  const isNew = docEntry === undefined;
  const { message } = App.useApp();
  // Read Only screen (the user's roles): no New / Edit
  const canChange = useCanChange();
  const router = useRouter();
  const [template, setTemplate] = useState<TemplateDetail | null>(null);
  const [stages, setStages] = useState<ApprovalTemplateStage[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  // Detail views open in view mode; Edit switches to edit mode
  const [editing, setEditing] = useState(isNew || startInEdit);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [documentTypes, setDocumentTypes] = useState<DocumentType[]>([]);
  const [form] = Form.useForm<TemplateFormValues>();
  const stagesGridRef = useRef<DataGridHandle<ApprovalTemplateStage>>(null);

  // Choices for the Document drop-down (FTS_vw_ObjType)
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
        const res = await approvalTemplatesAPI.getById(docEntry);
        if (res.success) {
          setTemplate(res.data);
          setStages(res.data.stages);
        }
      } catch {
        message.error('Failed to load approval template');
        router.push('/system/approval-templates');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [docEntry]);

  // Fill the form once it is on screen (it isn't rendered while loading)
  useEffect(() => {
    if (!loading && template) form.setFieldsValue(toFormValues(template));
  }, [loading]);

  const handleCancelEdit = () => {
    if (isNew) {
      router.push('/system/approval-templates');
      return;
    }
    // Discard unsaved changes, including added / removed stages
    form.resetFields();
    if (template) {
      form.setFieldsValue(toFormValues(template));
      setStages(template.stages);
    }
    setEditing(false);
  };

  const handleSave = async (values: TemplateFormValues) => {
    if (!editing) return;
    if (stages.length === 0) {
      message.error('Add at least one approval stage');
      return;
    }

    const payload = {
      wtmCode: values.wtmCode,
      wtmName: values.wtmName,
      objDoc: values.objDoc,
      active: values.active,
      query: values.query,
      stageIds: stages.map((s) => s.wstDocEntry),
    };

    setSaving(true);
    try {
      if (isNew) {
        const res = await approvalTemplatesAPI.create(payload);
        if (res.success) {
          message.success('Approval template created');
          router.replace(`/system/approval-templates/${res.data.docEntry}`);
        }
      } else {
        const res = await approvalTemplatesAPI.update(docEntry, payload);
        if (res.success) {
          message.success('Approval template updated');
          setTemplate(res.data);
          setStages(res.data.stages);
          form.setFieldsValue(toFormValues(res.data));
          setEditing(false);
        }
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      message.error(err.response?.data?.error || 'Failed to save approval template');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveStages = () => {
    const ticked = stagesGridRef.current?.getSelectedRows() ?? [];
    if (ticked.length === 0) {
      message.warning('Tick the approval stages to remove');
      return;
    }
    const removeIds = new Set(ticked.map((s) => s.wstDocEntry));
    setStages((prev) => prev.filter((s) => !removeIds.has(s.wstDocEntry)));
  };

  if (loading) {
    // The portal's own loading overlay (LOADING... bar) shows while the data is fetched; nothing else is drawn meanwhile
    return null;
  }

  if (!isNew && !template) return null;

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
      <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push('/system/approval-templates/new')}>
        New
      </Button>
      <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
        Edit
      </Button>
    </>
  );

  // Stages grid: Add / Remove only in edit mode; Reset View Settings is added by the grid
  const stagesToolbar = editing ? (
    <>
      <Button size="small" icon={<PlusOutlined />} onClick={() => setLookupOpen(true)}>
        Add Stage
      </Button>
      <Button size="small" icon={<MinusCircleOutlined />} onClick={handleRemoveStages}>
        Remove
      </Button>
    </>
  ) : null;

  return (
    <>
      {/* The Form wraps the whole view because the Query row sits in the wide section */}
      <Form form={form} {...detailFormProps(editing)} initialValues={{ active: true }} onFinish={handleSave}>
        <DetailView
          toolbar={toolbar}
          title={`Approval Template - ${isNew ? 'New' : template?.wtmCode}`}
          wideFields={
            <Form.Item
              label="Query"
              name="query"
              rules={[{ required: true, whitespace: true, message: 'Query is required' }]}
            >
              {editing ? <Input.TextArea rows={8} spellCheck={false} /> : <ReadOnlyText multiline />}
            </Form.Item>
          }
          below={
            <DataGrid<ApprovalTemplateStage>
              settingsKey="approval-template:stages"
              handleRef={stagesGridRef}
              showToolbar
              toolbar={stagesToolbar}
              // View mode: a click opens the stage (its approvers); not in edit mode, so unsaved changes aren't left
              onOpenRecord={editing ? undefined : (s) => router.push(`/system/approval-stages/${s.wstDocEntry}`)}
              gridProps={{ rowData: numberStages(stages), columnDefs: stageColumns, getRowId: (p) => String(p.data.wstDocEntry) }}
            />
          }
        >
          <Form.Item
            label="Template Code"
            name="wtmCode"
            rules={[
              { required: true, whitespace: true, message: 'Template code is required' },
              { max: 100, message: 'Maximum 100 characters' },
            ]}
          >
            {editing ? <Input /> : <ReadOnlyText />}
          </Form.Item>
          <Form.Item
            label="Description"
            name="wtmName"
            rules={[
              { required: true, whitespace: true, message: 'Description is required' },
              { max: 100, message: 'Maximum 100 characters' },
            ]}
          >
            {editing ? <Input /> : <ReadOnlyText />}
          </Form.Item>
          <Form.Item
            label="Document"
            name="objDoc"
            rules={[{ required: true, message: 'Document is required' }]}
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
          <Form.Item label="Active" name="active" valuePropName="checked">
            <Checkbox disabled={!editing} />
          </Form.Item>
        </DetailView>
      </Form>

      <LookupListView<ApprovalStage>
        open={lookupOpen}
        title="Add Approval Stage"
        searchPlaceholder="Search approval stages..."
        columnDefs={stageLookupColumns}
        loadRows={loadStages}
        getKey={(s) => s.docEntry}
        excludeKeys={stages.map((s) => s.wstDocEntry)}
        onCancel={() => setLookupOpen(false)}
        onSelect={(picked) => {
          setStages((prev) => [
            ...prev,
            ...picked.map((s) => ({ wstDocEntry: s.docEntry, wstCode: s.wstCode, wstName: s.wstName })),
          ]);
          setLookupOpen(false);
        }}
      />
    </>
  );
}
