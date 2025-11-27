# 01 - resolveAddressees 返回值重构

## 概述

修改 `ConversationCoordinator.resolveAddressees()` 方法，返回分离的解析结果，支持部分失败处理。

## 当前实现

**文件**: `src/services/ConversationCoordinator.ts:665-696`

```typescript
private resolveAddressees(addressees: string[]): Member[] {
  if (!this.team) {
    return [];
  }

  const members: Member[] = [];

  for (const addressee of addressees) {
    const normalizedAddressee = this.normalizeIdentifier(addressee);
    const member = this.team.members.find(m => {
      // 匹配逻辑...
    });

    if (member) {
      members.push(member);
    }
    // 注意：未匹配的 addressee 被静默丢弃
  }

  return members;
}
```

**问题**：
- 无法区分"全部解析失败"和"部分解析失败"
- 调用方无法知道哪些 addressee 未被解析
- 不符合"失败透明"设计原则

## 新设计

### 1. 新增类型定义

**文件**: `src/services/ConversationCoordinator.ts`（顶部类型区域）

```typescript
/**
 * 地址解析结果
 */
export interface ResolveResult {
  /** 成功解析的成员 */
  resolved: Member[];
  /** 未能解析的原始地址字符串 */
  unresolved: string[];
}
```

### 2. 方法签名变更

```typescript
// Before
private resolveAddressees(addressees: string[]): Member[]

// After
private resolveAddressees(addressees: string[]): ResolveResult
```

### 3. 新实现

```typescript
/**
 * 解析接收者标识为 Member 对象
 *
 * 实现模糊匹配：
 * - 支持 member.id 精确匹配
 * - 支持 member.name 和 member.displayName 模糊匹配
 * - 大小写不敏感
 * - 忽略空格和连字符
 *
 * @returns ResolveResult 包含 resolved 和 unresolved 两个数组
 */
private resolveAddressees(addressees: string[]): ResolveResult {
  const result: ResolveResult = {
    resolved: [],
    unresolved: []
  };

  if (!this.team) {
    // 无团队时，所有地址都无法解析
    result.unresolved = [...addressees];
    return result;
  }

  for (const addressee of addressees) {
    const normalizedAddressee = this.normalizeIdentifier(addressee);

    const member = this.team.members.find(m => {
      const normalizedId = this.normalizeIdentifier(m.id);
      if (normalizedId === normalizedAddressee) {
        return true;
      }

      const normalizedName = this.normalizeIdentifier(m.name);
      const normalizedDisplayName = this.normalizeIdentifier(m.displayName);
      return normalizedName === normalizedAddressee ||
             normalizedDisplayName === normalizedAddressee;
    });

    if (member) {
      result.resolved.push(member);
    } else {
      result.unresolved.push(addressee);
    }
  }

  return result;
}
```

## 调用方修改

### routeToNext() 方法

**当前代码** (line 395-473):
```typescript
// line 421-424
} else {
  // 解析接收者
  resolvedMembers = this.resolveAddressees(addressees);
}
```

**修改为**:
```typescript
} else {
  // 解析接收者
  const resolveResult = this.resolveAddressees(addressees);
  resolvedMembers = resolveResult.resolved;

  // 通知部分解析失败（由 02-partial-failure-notify 实现）
  if (resolveResult.unresolved.length > 0) {
    this.notifyPartialResolveFailure(resolveResult.unresolved, message);
  }
}
```

## 测试用例

**文件**: `tests/unit/conversationCoordinator.test.ts`

```typescript
describe('resolveAddressees', () => {
  it('returns all resolved when all addressees match', () => {
    // Setup team with members: alice, bob
    const result = coordinator['resolveAddressees'](['alice', 'bob']);

    expect(result.resolved).toHaveLength(2);
    expect(result.unresolved).toHaveLength(0);
  });

  it('returns partial results when some addressees fail', () => {
    const result = coordinator['resolveAddressees'](['alice', 'unknown', 'bob']);

    expect(result.resolved).toHaveLength(2);
    expect(result.unresolved).toEqual(['unknown']);
  });

  it('returns all unresolved when no addressees match', () => {
    const result = coordinator['resolveAddressees'](['unknown1', 'unknown2']);

    expect(result.resolved).toHaveLength(0);
    expect(result.unresolved).toEqual(['unknown1', 'unknown2']);
  });

  it('returns empty arrays for empty input', () => {
    const result = coordinator['resolveAddressees']([]);

    expect(result.resolved).toHaveLength(0);
    expect(result.unresolved).toHaveLength(0);
  });
});
```

## 回归风险

| 风险点 | 影响 | 缓解措施 |
|--------|------|----------|
| 返回值类型变更 | 所有调用方需更新 | 搜索 `resolveAddressees` 确保全部更新 |
| 解析逻辑变更 | 可能影响匹配结果 | 匹配逻辑保持不变，仅包装返回值 |

## 工作量估算

- 代码修改：~30 行
- 测试用例：~40 行
- 预估时间：0.5 小时
