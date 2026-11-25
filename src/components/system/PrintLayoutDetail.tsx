'use client';

import React, { useState, useEffect } from 'react';
import { App, Button, Checkbox, Form, Input, Select } from 'antd';
import { SaveOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { documentTypesAPI, printLayoutsAPI } from '@/lib/apiClient';
import { useCanChange } from '@/stores/accessStore';
import { DetailView, ReadOnlyText, detailFormProps } from '@/components/ui/DetailView';
import type { DocumentType, PrintLayout } from '@/types';

interface PrintLayoutDetailProps {
  /** Omit to create a new layout */
  docEntry?: number;
  /** Open an existing layout directly in edit mode (list view's Edit button) */
  startInEdit?: boolean;
}

interface LayoutFormValues {
  layoutName: string;
  objDoc: string;
  layoutPath: string;
  isActive: boolean;
  emailAllowed: boolean;
}

const toFormValues = (layout: PrintLayout): LayoutFormValues => ({
  layoutName: layout.layoutName,
  objDoc: layout.objDoc,
  layoutPath: layout.layoutPath,
  isActive: layout.isActive,
  emailAllowed: layout.emailAllowed,
});

/** View-mode Document: shows the name for the stored code (Form.Item passes the code as `value`) */
function DocumentName({ value, documentTypes }: { value?: string; documentTypes: DocumentType[] }) {
  const name = documentTypes.find((d) => d.code === value)?.name;
  return <ReadOnlyText value={name ?? value} />;
}

/**
 * Detail view of a print layout (FTS11SLYT): a Crystal Reports .rpt file a document type can be printed with.
 * The layout receives the document's DocEntry in its DocKey@ parameter. Existing layouts open in view mode.
 */
export default function PrintLayoutDetail({ docEntry, startInEdit = false }: PrintLayoutDetailProps) {
  const isNew = docEntry === undefined;
  const { message } = App.useApp();
  // Read Only screen (the user's roles): no New / Edit
  const canChange = useCanChange();
  const router = useRouter();
  const [layout, setLayout] = useState<PrintLayout | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  // Detail views open in view mode; Edit switches to edit mode
  const [editing, setEditing] = useState(isNew || startInEdit);
  const [documentTypes, setDocumentTypes] = useState<DocumentType[]>([]);
  const [form] = Form.useForm<LayoutFormValues>();

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
        const res = await printLayoutsAPI.getById(docEntry);
        if (res.success) setLayout(res.data);
      } catch {
        message.error('Failed to load layout');
        router.push('/system/print-layouts');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [docEntry]);

  // Fill the form once it is on screen (it isn't rendered while loading)
  useEffect(() => {
    if (!loading && layout) form.setFieldsValue(toFormValues(layout));
  }, [loading]);

  const handleCancelEdit = () => {
    if (isNew) {
      router.push('/system/print-layouts');
      return;
    }
    form.resetFields();
    if (layout) form.setFieldsValue(toFormValues(layout));
    setEditing(false);
  };

  const handleSave = async (values: LayoutFormValues) => {
    if (!editing) return;
    const payload = {
      layoutName: values.layoutName,
      objDoc: values.objDoc,
      layoutPath: values.layoutPath,
      isActive: !!values.isActive,
      emailAllowed: !!values.emailAllowed,
    };
    setSaving(true);
    try {
      if (isNew) {
        const res = await printLayoutsAPI.create(payload);
        if (res.success) {
          message.success('Layout created');
          router.replace(`/system/print-layouts/${res.data.docEntry}`);
        }
      } else {
        const res = await printLayoutsAPI.update(docEntry, payload);
        if (res.success) {
          message.success('Layout updated');
          setLayout(res.data);
          form.setFieldsValue(toFormValues(res.data));
          setEditing(false);
        }
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      message.error(err.response?.data?.error || 'Failed to save layout');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    // The portal's own loading overlay (LOADING... bar) shows while the data is fetched; nothing else is drawn meanwhile
    return null;
  }

  if (!isNew && !layout) return null;

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
      <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push('/system/print-layouts/new')}>
        New
      </Button>
      <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
        Edit
      </Button>
    </>
  );

  return (
    <DetailView toolbar={toolbar} title={`Layout - ${isNew ? 'New' : layout?.layoutName}`}>
      <Form form={form} {...detailFormProps(editing)} initialValues={{ isActive: true, emailAllowed: false }} onFinish={handleSave}>
        <Form.Item
          label="Layout Name"
          name="layoutName"
          rules={[
            { required: true, whitespace: true, message: 'Layout Name is required' },
            { max: 100, message: 'Maximum 100 characters' },
          ]}
        >
          {editing ? <Input /> : <ReadOnlyText />}
        </Form.Item>
        <Form.Item label="Document" name="objDoc" rules={[{ required: true, message: 'Document is required' }]}>
          {editing ? (
            <Select
              placeholder="Select a document"
              options={documentTypes.map((d) => ({ value: d.code, label: d.name }))}
            />
          ) : (
            <DocumentName documentTypes={documentTypes} />
          )}
        </Form.Item>
        {/* The .rpt file on the server; it receives the document's DocEntry in its DocKey@ parameter */}
        <Form.Item
          label="Layout Path"
          name="layoutPath"
          rules={[
            { required: true, whitespace: true, message: 'Layout Path is required' },
            { max: 254, message: 'Maximum 254 characters' },
          ]}
        >
          {editing ? <Input placeholder="e.g. D:\SalesPortal_Layouts\SalesQuotation.rpt" /> : <ReadOnlyText />}
        </Form.Item>
        <Form.Item label="Active" name="isActive" valuePropName="checked">
          <Checkbox disabled={!editing} />
        </Form.Item>
        {/* The printed PDF's window shows E-mail (to the customer's e-mail, through General Settings > SMTP) */}
        <Form.Item label="Allow E-mail" name="emailAllowed" valuePropName="checked">
          <Checkbox disabled={!editing} />
        </Form.Item>
      </Form>
    </DetailView>
  );
}
