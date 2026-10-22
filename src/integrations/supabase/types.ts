export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      leads: {
        Row: {
          company_name: string | null;
          created_at: string;
          email: string;
          id: string;
          lead_status: Database["public"]["Enums"]["lead_status"];
          name: string;
          notes: string | null;
          offer_id: string | null;
          operator_id: string | null;
          phone: string | null;
          team_id: string | null;
          updated_at: string;
          user_id: string;
          workspace_id: string;
        };
        Insert: {
          company_name?: string | null;
          created_at?: string;
          email: string;
          id?: string;
          lead_status?: Database["public"]["Enums"]["lead_status"];
          name: string;
          notes?: string | null;
          offer_id?: string | null;
          operator_id?: string | null;
          phone?: string | null;
          team_id?: string | null;
          updated_at?: string;
          user_id: string;
          workspace_id?: string;
        };
        Update: {
          company_name?: string | null;
          created_at?: string;
          email?: string;
          id?: string;
          lead_status?: Database["public"]["Enums"]["lead_status"];
          name?: string;
          notes?: string | null;
          offer_id?: string | null;
          operator_id?: string | null;
          phone?: string | null;
          team_id?: string | null;
          updated_at?: string;
          user_id?: string;
          workspace_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      accept_workspace_invitation: {
        Args: { p_token_hash: string };
        Returns: string;
      };
      create_workspace_invitation: {
        Args: {
          p_email: string;
          p_role: string;
          p_token_hash: string;
          p_workspace_id: string;
        };
        Returns: string;
      };
      create_workspace_offer: {
        Args: { p_name: string; p_workspace_id: string };
        Returns: string;
      };
      create_workspace_team: {
        Args: { p_name: string; p_workspace_id: string };
        Returns: string;
      };
      get_workspace_invitations: {
        Args: { p_workspace_id: string };
        Returns: {
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          invited_by: string | null;
          role: string;
          status: string;
        }[];
      };
      get_workspace_access_audit: {
        Args: { p_limit: number; p_workspace_id: string };
        Returns: {
          action: string;
          actor_id: string | null;
          created_at: string;
          details: Json;
          id: number;
          subject_user_id: string | null;
        }[];
      };
      get_workspace_offers: {
        Args: { p_workspace_id: string };
        Returns: { created_at: string; id: string; name: string }[];
      };
      get_workspace_teams: {
        Args: { p_workspace_id: string };
        Returns: { created_at: string; id: string; name: string }[];
      };
      get_workspace_member_permissions: {
        Args: { p_user_id: string; p_workspace_id: string };
        Returns: {
          allowed: boolean;
          delegable: boolean;
          permission_key: string;
          scope_id: string | null;
          scope_type: string;
        }[];
      };
      get_workspace_members: {
        Args: { p_workspace_id: string };
        Returns: {
          created_at: string;
          email: string | null;
          role: string;
          status: string;
          user_id: string;
        }[];
      };
      has_workspace_permission: {
        Args: {
          p_offer_id: string | null;
          p_operator_id: string | null;
          p_permission_key: string;
          p_team_id: string | null;
          p_workspace_id: string;
        };
        Returns: boolean;
      };
      main_workspace_id: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      my_workspaces: {
        Args: Record<PropertyKey, never>;
        Returns: {
          id: string;
          is_super_admin: boolean;
          name: string;
          role: string;
          slug: string;
        }[];
      };
      permission_scope_matches: {
        Args: {
          p_actor_id: string;
          p_offer_id: string | null;
          p_operator_id: string | null;
          p_scope_id: string | null;
          p_scope_type: Database["public"]["Enums"]["workspace_scope_type"];
          p_team_id: string | null;
          p_workspace_id: string;
        };
        Returns: boolean;
      };
      revoke_workspace_invitation: {
        Args: { p_invitation_id: string; p_workspace_id: string };
        Returns: boolean;
      };
      set_workspace_member_permission: {
        Args: {
          p_allowed: boolean | null;
          p_delegable: boolean;
          p_permission_key: string;
          p_scope_id: string | null;
          p_scope_type: string;
          p_user_id: string;
          p_workspace_id: string;
        };
        Returns: boolean;
      };
      set_workspace_member_role: {
        Args: { p_role: string; p_user_id: string; p_workspace_id: string };
        Returns: boolean;
      };
      validate_workspace_invitation: {
        Args: { p_token_hash: string };
        Returns: {
          email: string;
          expires_at: string;
          role: string;
          workspace_name: string;
        }[];
      };
    };
    Enums: {
      lead_status: "New" | "Contacted" | "Qualified" | "Converted" | "Lost";
      workspace_member_role: "admin" | "operator" | "viewer";
      workspace_permission_authority: "super_admin" | "admin";
      workspace_scope_type: "workspace" | "team" | "operator" | "offer";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      lead_status: ["New", "Contacted", "Qualified", "Converted", "Lost"],
      workspace_member_role: ["admin", "operator", "viewer"],
      workspace_permission_authority: ["super_admin", "admin"],
      workspace_scope_type: ["workspace", "team", "operator", "offer"],
    },
  },
} as const;
