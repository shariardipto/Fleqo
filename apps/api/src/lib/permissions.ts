import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements, memberAc, ownerAc } from "better-auth/plugins/organization/access";

/**
 * Single permission model shared by Better Auth (organization/member/invitation endpoints)
 * and Fleqo's own routes (connections, workflows, executions, demo data, audit).
 */
export const statement = {
  ...defaultStatements,
  connection: ["read", "manage"],
  workflow: ["read", "manage"],
  execution: ["read", "retry"],
  demo: ["import", "simulate"],
  audit: ["read"],
} as const;

export const ac = createAccessControl(statement);

const operatorPermissions = {
  connection: ["read", "manage"],
  workflow: ["read", "manage"],
  execution: ["read", "retry"],
  demo: ["import", "simulate"],
  audit: ["read"],
} as const;

export const roles = {
  owner: ac.newRole({ ...ownerAc.statements, ...operatorPermissions }),
  admin: ac.newRole({ ...adminAc.statements, ...operatorPermissions }),
  member: ac.newRole({
    ...memberAc.statements,
    connection: ["read"],
    workflow: ["read"],
    execution: ["read"],
    demo: ["simulate"],
    audit: [],
  }),
};

export type RoleName = keyof typeof roles;
export type Resource = keyof typeof statement;
export type PermissionRequest = { [K in Resource]?: (typeof statement)[K][number][] };

/** Better Auth stores multiple roles as a comma-separated string. Any granted role is sufficient. */
export function roleHasPermission(roleValue: string, request: PermissionRequest): boolean {
  return roleValue
    .split(",")
    .map((role) => role.trim())
    .some((role) => {
      const definition = roles[role as RoleName];
      return definition ? definition.authorize(request).success : false;
    });
}

export function isRoleName(value: string): value is RoleName {
  return value in roles;
}
