"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, Table, Typography, Space, Button, Tag, Modal, Form, Input, Select, Popconfirm, Tooltip, Alert, Checkbox } from "antd";
import { message } from "@/components/admin/antd-app";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { ALL_PERMISSIONS, DEFAULT_STAFF_PERMISSIONS, PERMISSIONS, PERMISSION_PRESETS, type AdminRole, type Permission } from "@/lib/admin-auth";
import { useAdminRole } from "@/lib/admin-role-context";
import { apiJson } from "@/components/admin/stock/stock-client";
import { msg, useAdminT } from "@/lib/admin-i18n";

const { Title, Text } = Typography;

interface Member {
    id: string;
    email: string;
    role: AdminRole;
    permissions: Permission[];
    locked: boolean;
    last_sign_in_at: string | null;
    created_at: string;
}

/** Checkbox list of staff permissions with one-click presets. */
function PermissionPicker({ value = [], onChange }: { value?: Permission[]; onChange?: (value: Permission[]) => void }) {
    const { t } = useAdminT();
    return (
        <Space orientation="vertical" style={{ width: "100%" }}>
            <Space wrap size={4}>
                <Text type="secondary" style={{ fontSize: 12 }}>{t("Start from:")}</Text>
                {PERMISSION_PRESETS.map((preset) => (
                    <Button key={preset.label} size="small" onClick={() => onChange?.(preset.permissions)}>{t(preset.label)}</Button>
                ))}
            </Space>
            <Checkbox.Group value={value} onChange={(checked) => onChange?.(checked as Permission[])} style={{ width: "100%" }}>
                <Space orientation="vertical" size={6}>
                    {ALL_PERMISSIONS.map((p) => (
                        <Checkbox key={p} value={p}>
                            <strong>{t(PERMISSIONS[p].label)}</strong>
                            <Text type="secondary" style={{ marginInlineStart: 8, fontSize: 12 }}>{t(PERMISSIONS[p].description)}</Text>
                        </Checkbox>
                    ))}
                </Space>
            </Checkbox.Group>
        </Space>
    );
}

const ROLE_OPTIONS = [
    { value: "staff", label: msg("Staff") },
    { value: "admin", label: msg("Admin") },
    { value: "owner", label: msg("Owner") },
];

const ROLE_TAGS: Record<AdminRole, { color: string; label: string }> = {
    owner: { color: "gold", label: msg("Owner") },
    admin: { color: "purple", label: msg("Admin") },
    staff: { color: "blue", label: msg("Staff") },
};

export default function TeamPage() {
    const { t } = useAdminT();
    const { email: myEmail, isOwner } = useAdminRole();
    // Only owners give the owner role or change an owner.
    const roleOptions = ROLE_OPTIONS.filter((o) => isOwner || o.value !== "owner").map((o) => ({ ...o, label: t(o.label) }));
    const canManage = (m: Member) => isOwner || m.role !== "owner";
    const [members, setMembers] = useState<Member[]>([]);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form] = Form.useForm();
    const newRole = Form.useWatch("role", form);
    const [editing, setEditing] = useState<Member | null>(null);
    const [editPermissions, setEditPermissions] = useState<Permission[]>([]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setMembers(await apiJson<Member[]>("/api/admin/team"));
        } catch (e) {
            message.error(t((e as Error).message));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const changeRole = async (member: Member, role: AdminRole | null, permissions?: Permission[]) => {
        try {
            await apiJson("/api/admin/team", { method: "PUT", body: JSON.stringify({ id: member.id, role, permissions }) });
            message.success(
                permissions
                    ? t("Access updated for {email}", { email: member.email })
                    : role === "owner" ? t("{email} is now an owner", { email: member.email })
                    : role === "admin" ? t("{email} is now an admin", { email: member.email })
                    : role ? t("{email} is now staff", { email: member.email })
                    : t("{email} no longer has access", { email: member.email })
            );
            setEditing(null);
            load();
        } catch (e) {
            message.error(t((e as Error).message));
        }
    };

    const deleteMember = async (member: Member) => {
        try {
            await apiJson(`/api/admin/team?id=${member.id}`, { method: "DELETE" });
            message.success(t("{email} deleted", { email: member.email }));
            load();
        } catch (e) {
            message.error(t((e as Error).message));
        }
    };

    const invite = async () => {
        const values = await form.validateFields();
        setSaving(true);
        try {
            await apiJson("/api/admin/team", { method: "POST", body: JSON.stringify(values) });
            message.success(t("Account created for {email}", { email: values.email }));
            setOpen(false);
            form.resetFields();
            load();
        } catch (e) {
            message.error(t((e as Error).message));
        } finally {
            setSaving(false);
        }
    };

    const columns: ColumnsType<Member> = [
        { title: t("Email"), dataIndex: "email", render: (email: string) => <>{email}{email === myEmail && <Tag style={{ marginInlineStart: 8 }}>{t("You")}</Tag>}</> },
        {
            title: t("Role"),
            key: "role",
            render: (_, m) =>
                m.locked || m.email === myEmail || !canManage(m) ? (
                    <Tooltip
                        title={
                            m.locked ? t("Set by the OWNER_EMAILS or ADMIN_EMAILS server setting")
                            : m.email === myEmail ? t("You can't change your own role")
                            : t("Only an owner can change an owner")
                        }
                    >
                        <Tag color={ROLE_TAGS[m.role].color}>{t(ROLE_TAGS[m.role].label)}</Tag>
                    </Tooltip>
                ) : (
                    <Select size="small" style={{ width: 110 }} value={m.role} options={roleOptions} onChange={(role) => changeRole(m, role)} />
                ),
        },
        {
            title: t("Access"),
            key: "permissions",
            render: (_, m) =>
                m.role === "owner" ? (
                    <Text type="secondary">{t("Everything, plus owner alerts")}</Text>
                ) : m.role === "admin" ? (
                    <Text type="secondary">{t("Everything, including team")}</Text>
                ) : (
                    <Space size={[4, 4]} wrap>
                        {m.permissions.length === 0 && <Text type="secondary">{t("Dashboard only")}</Text>}
                        {m.permissions.map((p) => <Tag key={p}>{t(PERMISSIONS[p].label)}</Tag>)}
                        {m.email !== myEmail && (
                            <Button size="small" type="link" onClick={() => { setEditing(m); setEditPermissions(m.permissions); }}>{t("Edit")}</Button>
                        )}
                    </Space>
                ),
        },
        { title: t("Last sign-in"), dataIndex: "last_sign_in_at", render: (d: string | null) => (d ? dayjs(d).format("DD MMM YYYY HH:mm") : <Text type="secondary">{t("Never")}</Text>) },
        {
            key: "actions",
            width: 320,
            render: (_, m) => (
                <Space size={0}>
                    <Link href={`/admin/activity?actor=${m.id}`}>
                        <Button type="text">{t("Activity")}</Button>
                    </Link>
                    {!m.locked && m.email !== myEmail && canManage(m) && (
                        <>
                            <Popconfirm
                                title={t("Remove {email}'s access?", { email: m.email })}
                                description={t("The account stays (they can still shop with it), but it can't open the admin.")}
                                okText={t("Remove access")}
                                okButtonProps={{ danger: true }}
                                onConfirm={() => changeRole(m, null)}
                            >
                                <Button type="text">{t("Remove access")}</Button>
                            </Popconfirm>
                            <Popconfirm
                                title={t("Delete {email}'s account?", { email: m.email })}
                                description={t("The account is deactivated and can't sign in. It is kept with its history.")}
                                okText={t("Delete account")}
                                okButtonProps={{ danger: true }}
                                onConfirm={() => deleteMember(m)}
                            >
                                <Button danger type="text">{t("Delete")}</Button>
                            </Popconfirm>
                        </>
                    )}
                </Space>
            ),
        },
    ];

    return (
        <Space orientation="vertical" size="large" style={{ width: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                <div>
                    <Title level={2} style={{ margin: 0 }}>{t("Team")}</Title>
                    <Text type="secondary">{t("Who can open the admin.")}</Text>
                </div>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>{t("Add member")}</Button>
            </div>
            <Alert
                type="info"
                showIcon
                title={t("Admins can do everything. Staff only see and change the areas you tick for them, and only admins manage the team. Role and access changes sign the person out and apply within 15 minutes.")}
            />
            <Modal
                open={!!editing}
                title={editing ? t("Access for {email}", { email: editing.email }) : ""}
                okText={t("Save access")}
                onOk={() => editing && changeRole(editing, "staff", editPermissions)}
                onCancel={() => setEditing(null)}
                destroyOnHidden
            >
                <PermissionPicker value={editPermissions} onChange={setEditPermissions} />
                <Text type="secondary" style={{ display: "block", marginTop: 16, fontSize: 12 }}>
                    {t("Changes apply the next time their session refreshes (within an hour) or when they sign in again.")}
                </Text>
            </Modal>
            <Card>
                <Table rowKey="id" loading={loading} columns={columns} dataSource={members} pagination={false} />
            </Card>
            <Modal
                open={open}
                title={t("Add team member")}
                okText={t("Create account")}
                confirmLoading={saving}
                onOk={invite}
                onCancel={() => setOpen(false)}
                destroyOnHidden
            >
                <Form form={form} layout="vertical" requiredMark={false} initialValues={{ role: "staff", permissions: DEFAULT_STAFF_PERMISSIONS }}>
                    <Form.Item name="email" label={t("Email")} rules={[{ required: true, type: "email", message: t("Enter a valid email") }]}>
                        <Input autoComplete="off" />
                    </Form.Item>
                    <Form.Item
                        name="password"
                        label={t("Temporary password")}
                        extra={t("Share it with them privately. They sign in at /admin/login.")}
                        rules={[{ required: true, min: 8, message: t("At least 8 characters") }]}
                    >
                        <Input.Password autoComplete="new-password" />
                    </Form.Item>
                    <Form.Item
                        name="role"
                        label={t("Role")}
                        extra={
                            newRole === "owner" ? t("Owners can do everything and are alerted about deletes and unusual actions by admins and staff.")
                            : newRole === "admin" ? t("Admins can do everything, including managing the team.")
                            : undefined
                        }
                    >
                        <Select options={roleOptions} />
                    </Form.Item>
                    {newRole === "staff" && (
                        <Form.Item name="permissions" label={t("What they can do")}>
                            <PermissionPicker />
                        </Form.Item>
                    )}
                </Form>
            </Modal>
        </Space>
    );
}
