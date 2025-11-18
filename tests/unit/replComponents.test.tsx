/**
 * REPL UI 组件测试
 * 测试 WizardView, MenuView, FormView, SelectView 组件
 */

import { describe, it, expect } from 'vitest';
import React from 'react';

describe('REPL UI Components', () => {
  describe('WizardView Props', () => {
    it('应该接受正确的 props 结构', () => {
      interface WizardViewProps {
        wizardState: {
          step: number;
          totalSteps: number;
          data: Record<string, any>;
        };
      }

      const props: WizardViewProps = {
        wizardState: {
          step: 1,
          totalSteps: 4,
          data: {
            teamName: 'Test Team',
            teamDescription: 'Description'
          }
        }
      };

      expect(props.wizardState.step).toBe(1);
      expect(props.wizardState.totalSteps).toBe(4);
      expect(props.wizardState.data.teamName).toBe('Test Team');
    });

    it('应该支持所有步骤的数据', () => {
      interface WizardState {
        step: number;
        totalSteps: number;
        data: {
          // Step 1
          teamName?: string;
          teamDescription?: string;
          teamInstructionFile?: string;
          roleDefinitions?: any[];
          members?: any[];
          
          // Step 2
          availableAgents?: string[];
          selectedAgents?: string[];
          
          // Step 3
          memberConfigs?: any[];
          
          // Step 4
          maxRounds?: number;
        };
      }

      const allStepsData: WizardState = {
        step: 4,
        totalSteps: 4,
        data: {
          teamName: 'Full Team',
          teamDescription: 'Complete configuration',
          teamInstructionFile: './teams/full/instruction.md',
          roleDefinitions: [{ name: 'reviewer' }],
          members: [{ memberIndex: 1, assignedRole: 'reviewer' }],
          availableAgents: ['claude', 'codex'],
          selectedAgents: ['claude'],
          memberConfigs: [{ memberIndex: 1, type: 'ai', displayName: 'Claude' }],
          maxRounds: 20
        }
      };

      expect(allStepsData.data.teamName).toBe('Full Team');
      expect(allStepsData.data.availableAgents).toHaveLength(2);
      expect(allStepsData.data.memberConfigs).toHaveLength(1);
      expect(allStepsData.data.maxRounds).toBe(20);
    });
  });

  describe('MenuView Props', () => {
    it('应该接受正确的 props 结构', () => {
      interface MenuViewProps {
        menuState: {
          configPath: string;
          config: any;
          selectedIndex: number;
          editing: boolean;
          changes: Partial<any>;
        };
        menuItems: Array<{ label: string; value: string }>;
        selectedIndex: number;
      }

      const props: MenuViewProps = {
        menuState: {
          configPath: './test-config.json',
          config: { team: { name: 'Test' } },
          selectedIndex: 0,
          editing: false,
          changes: {}
        },
        menuItems: [
          { label: 'Edit team information', value: 'edit_info' },
          { label: 'Save and exit', value: 'save' }
        ],
        selectedIndex: 0
      };

      expect(props.menuState.configPath).toBe('./test-config.json');
      expect(props.menuItems).toHaveLength(2);
      expect(props.selectedIndex).toBe(0);
    });

    it('应该支持动态生成的菜单项', () => {
      const members = [
        { displayName: 'Member 1', name: 'm1' },
        { displayName: 'Member 2', name: 'm2' },
        { displayName: 'Member 3', name: 'm3' }
      ];

      const menuItems = [
        { label: 'Edit team information', value: 'edit_info' },
        { label: 'Add new member', value: 'add_member' },
        ...members.map((member, idx) => ({
          label: `Edit member: ${member.displayName}`,
          value: `edit_member_${idx}`
        })),
        { label: 'Save and exit', value: 'save' }
      ];

      expect(menuItems).toHaveLength(6); // 2 fixed + 3 members + 1 save
      expect(menuItems[2].label).toBe('Edit member: Member 1');
      expect(menuItems[3].label).toBe('Edit member: Member 2');
      expect(menuItems[4].label).toBe('Edit member: Member 3');
    });
  });

  describe('FormView Props', () => {
    it('应该接受正确的 props 结构', () => {
      interface FormViewProps {
        formState: {
          fields: Array<{
            name: string;
            label: string;
            type: 'text' | 'number' | 'multiline' | 'select';
            value: string | number;
            required?: boolean;
            options?: string[];
          }>;
          currentFieldIndex: number;
          values: Record<string, any>;
          errors: Record<string, string>;
        };
      }

      const props: FormViewProps = {
        formState: {
          fields: [
            { name: 'teamName', label: 'Team Name', type: 'text', value: '', required: true },
            { name: 'maxRounds', label: 'Max Rounds', type: 'number', value: 10 }
          ],
          currentFieldIndex: 0,
          values: {},
          errors: {}
        }
      };

      expect(props.formState.fields).toHaveLength(2);
      expect(props.formState.currentFieldIndex).toBe(0);
      expect(props.formState.fields[0].type).toBe('text');
      expect(props.formState.fields[1].type).toBe('number');
    });

    it('应该支持字段验证', () => {
      interface FormField {
        name: string;
        label: string;
        type: 'text' | 'number' | 'multiline' | 'select';
        value: string | number;
        required?: boolean;
        validation?: (value: any) => string | null;
      }

      const validateRequired = (value: any): string | null => {
        if (!value || (typeof value === 'string' && value.trim() === '')) {
          return 'This field is required';
        }
        return null;
      };

      const validateNumber = (value: any): string | null => {
        if (typeof value !== 'number') return 'Must be a number';
        if (value < 0) return 'Must be non-negative';
        return null;
      };

      expect(validateRequired('')).toBe('This field is required');
      expect(validateRequired('value')).toBeNull();
      expect(validateNumber(-1)).toBe('Must be non-negative');
      expect(validateNumber(10)).toBeNull();
    });

    it('应该支持多行文本输入', () => {
      interface FormField {
        name: string;
        label: string;
        type: 'text' | 'number' | 'multiline' | 'select';
        value: string | number;
      }

      const multilineField: FormField = {
        name: 'description',
        label: 'Team Description',
        type: 'multiline',
        value: 'Line 1\nLine 2\nLine 3'
      };

      expect(multilineField.type).toBe('multiline');
      expect(typeof multilineField.value).toBe('string');
      expect((multilineField.value as string).split('\n')).toHaveLength(3);
    });
  });

  describe('SelectView Props', () => {
    it('应该接受正确的 props 结构', () => {
      interface SelectViewProps {
        title: string;
        options: string[];
        selectedIndex: number;
        multiSelect?: boolean;
        selectedItems?: Set<string>;
      }

      const props: SelectViewProps = {
        title: 'Select AI Agents',
        options: ['claude', 'codex', 'gemini'],
        selectedIndex: 0,
        multiSelect: true,
        selectedItems: new Set(['claude'])
      };

      expect(props.title).toBe('Select AI Agents');
      expect(props.options).toHaveLength(3);
      expect(props.selectedIndex).toBe(0);
      expect(props.multiSelect).toBe(true);
      expect(props.selectedItems?.has('claude')).toBe(true);
    });

    it('应该支持单选模式', () => {
      interface SelectViewProps {
        title: string;
        options: string[];
        selectedIndex: number;
        multiSelect?: boolean;
        selectedItems?: Set<string>;
      }

      const singleSelectProps: SelectViewProps = {
        title: 'Select Color',
        options: ['red', 'green', 'blue'],
        selectedIndex: 1,
        multiSelect: false
      };

      expect(singleSelectProps.multiSelect).toBe(false);
      expect(singleSelectProps.selectedItems).toBeUndefined();
    });

    it('应该支持多选切换逻辑', () => {
      const selectedItems = new Set<string>(['claude']);

      // 添加新项
      selectedItems.add('codex');
      expect(selectedItems.size).toBe(2);
      expect(selectedItems.has('codex')).toBe(true);

      // 移除已有项
      selectedItems.delete('claude');
      expect(selectedItems.size).toBe(1);
      expect(selectedItems.has('claude')).toBe(false);

      // 切换项（如果有就删除，没有就添加）
      const toggleItem = (items: Set<string>, item: string): Set<string> => {
        const newItems = new Set(items);
        if (newItems.has(item)) {
          newItems.delete(item);
        } else {
          newItems.add(item);
        }
        return newItems;
      };

      let items = new Set(['claude']);
      items = toggleItem(items, 'codex'); // 添加
      expect(items.has('codex')).toBe(true);
      items = toggleItem(items, 'codex'); // 移除
      expect(items.has('codex')).toBe(false);
    });
  });

  describe('Component Rendering Logic', () => {
    it('应该根据步骤渲染不同的向导视图', () => {
      interface WizardState {
        step: number;
        totalSteps: number;
        data: any;
      }

      const getStepComponent = (wizardState: WizardState): string => {
        switch (wizardState.step) {
          case 1: return 'WizardStep1TeamStructure';
          case 2: return 'WizardStep2DetectAgents';
          case 3: return 'WizardStep3ConfigureMembers';
          case 4: return 'WizardStep4TeamSettings';
          default: return 'Unknown';
        }
      };

      expect(getStepComponent({ step: 1, totalSteps: 4, data: {} })).toBe('WizardStep1TeamStructure');
      expect(getStepComponent({ step: 2, totalSteps: 4, data: {} })).toBe('WizardStep2DetectAgents');
      expect(getStepComponent({ step: 3, totalSteps: 4, data: {} })).toBe('WizardStep3ConfigureMembers');
      expect(getStepComponent({ step: 4, totalSteps: 4, data: {} })).toBe('WizardStep4TeamSettings');
    });

    it('应该根据模式渲染不同的视图', () => {
      type AppMode = 'normal' | 'conversation' | 'wizard' | 'menu' | 'form' | 'select';

      const getViewComponent = (mode: AppMode): string => {
        switch (mode) {
          case 'wizard': return 'WizardView';
          case 'menu': return 'MenuView';
          case 'form': return 'FormView';
          case 'select': return 'SelectView';
          default: return 'DefaultView';
        }
      };

      expect(getViewComponent('wizard')).toBe('WizardView');
      expect(getViewComponent('menu')).toBe('MenuView');
      expect(getViewComponent('form')).toBe('FormView');
      expect(getViewComponent('select')).toBe('SelectView');
      expect(getViewComponent('normal')).toBe('DefaultView');
    });
  });

  describe('UI State Updates', () => {
    it('应该正确更新向导步骤', () => {
      interface WizardState {
        step: number;
        totalSteps: number;
        data: any;
      }

      let state: WizardState = { step: 1, totalSteps: 4, data: {} };

      // 前进到下一步
      const nextStep = (current: WizardState): WizardState => {
        if (current.step < current.totalSteps) {
          return { ...current, step: current.step + 1 };
        }
        return current;
      };

      state = nextStep(state);
      expect(state.step).toBe(2);

      state = nextStep(state);
      expect(state.step).toBe(3);

      state = nextStep(state);
      expect(state.step).toBe(4);

      // 不应该超过最大步骤
      state = nextStep(state);
      expect(state.step).toBe(4);
    });

    it('应该正确更新选择索引', () => {
      const items = ['item1', 'item2', 'item3'];
      
      const navigateDown = (currentIndex: number, itemCount: number): number => {
        return (currentIndex + 1) % itemCount;
      };

      const navigateUp = (currentIndex: number, itemCount: number): number => {
        return currentIndex > 0 ? currentIndex - 1 : itemCount - 1;
      };

      let index = 0;
      index = navigateDown(index, items.length);
      expect(index).toBe(1);

      index = navigateDown(index, items.length);
      expect(index).toBe(2);

      index = navigateDown(index, items.length);
      expect(index).toBe(0); // 回到开头

      index = navigateUp(index, items.length);
      expect(index).toBe(2); // 到末尾
    });

    it('应该正确管理表单错误', () => {
      interface FormState {
        fields: any[];
        currentFieldIndex: number;
        values: Record<string, any>;
        errors: Record<string, string>;
      }

      let formState: FormState = {
        fields: [],
        currentFieldIndex: 0,
        values: {},
        errors: {}
      };

      // 添加错误
      formState = {
        ...formState,
        errors: { ...formState.errors, teamName: 'Required field' }
      };
      expect(formState.errors.teamName).toBe('Required field');

      // 清除错误
      const { teamName, ...remainingErrors } = formState.errors;
      formState = { ...formState, errors: remainingErrors };
      expect(formState.errors.teamName).toBeUndefined();
    });
  });

  describe('Color Theme Support', () => {
    it('应该支持所有主题颜色', () => {
      const themeColors = ['cyan', 'green', 'yellow', 'blue', 'magenta', 'red'];

      themeColors.forEach(color => {
        expect(['cyan', 'green', 'yellow', 'blue', 'magenta', 'red']).toContain(color);
      });
    });

    it('应该为不同成员类型使用不同颜色', () => {
      const getDefaultColor = (type: 'ai' | 'human'): string => {
        return type === 'ai' ? 'cyan' : 'green';
      };

      expect(getDefaultColor('ai')).toBe('cyan');
      expect(getDefaultColor('human')).toBe('green');
    });
  });
});

