export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      chats: {
        Row: {
          access_hash: string | null
          access_status: string
          chat_type: string
          created_at: string
          id: string
          telegram_chat_id: number
          title: string | null
          updated_at: string
          user_id: string
          username: string | null
        }
        Insert: {
          access_hash?: string | null
          access_status?: string
          chat_type?: string
          created_at?: string
          id?: string
          telegram_chat_id: number
          title?: string | null
          updated_at?: string
          user_id: string
          username?: string | null
        }
        Update: {
          access_hash?: string | null
          access_status?: string
          chat_type?: string
          created_at?: string
          id?: string
          telegram_chat_id?: number
          title?: string | null
          updated_at?: string
          user_id?: string
          username?: string | null
        }
        Relationships: []
      }
      job_chats: {
        Row: {
          access_status: string
          chat_id: string
          created_at: string
          eligible: boolean
          folder_id: string | null
          id: string
          is_duplicate: boolean
          job_id: string
          telegram_chat_id: number
          user_id: string
        }
        Insert: {
          access_status?: string
          chat_id: string
          created_at?: string
          eligible?: boolean
          folder_id?: string | null
          id?: string
          is_duplicate?: boolean
          job_id: string
          telegram_chat_id: number
          user_id: string
        }
        Update: {
          access_status?: string
          chat_id?: string
          created_at?: string
          eligible?: boolean
          folder_id?: string | null
          id?: string
          is_duplicate?: boolean
          job_id?: string
          telegram_chat_id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_chats_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_chats_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "job_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_chats_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_folders: {
        Row: {
          chats_found: number
          created_at: string
          error: string | null
          id: string
          job_id: string
          position: number
          slug: string | null
          status: string
          title: string | null
          updated_at: string
          url: string
          user_id: string
        }
        Insert: {
          chats_found?: number
          created_at?: string
          error?: string | null
          id?: string
          job_id: string
          position?: number
          slug?: string | null
          status?: string
          title?: string | null
          updated_at?: string
          url: string
          user_id: string
        }
        Update: {
          chats_found?: number
          created_at?: string
          error?: string | null
          id?: string
          job_id?: string
          position?: number
          slug?: string | null
          status?: string
          title?: string | null
          updated_at?: string
          url?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_folders_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          bot_chat_id: number | null
          created_at: string
          duplicate_chats: number
          error: string | null
          final_chats: number
          folder_name: string | null
          folders_failed: number
          folders_ok: number
          folders_total: number
          id: string
          inaccessible_chats: number
          share_link: string | null
          share_link_note: string | null
          stage: string | null
          status: string
          total_chats: number
          unique_chats: number
          updated_at: string
          user_id: string
        }
        Insert: {
          bot_chat_id?: number | null
          created_at?: string
          duplicate_chats?: number
          error?: string | null
          final_chats?: number
          folder_name?: string | null
          folders_failed?: number
          folders_ok?: number
          folders_total?: number
          id?: string
          inaccessible_chats?: number
          share_link?: string | null
          share_link_note?: string | null
          stage?: string | null
          status?: string
          total_chats?: number
          unique_chats?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          bot_chat_id?: number | null
          created_at?: string
          duplicate_chats?: number
          error?: string | null
          final_chats?: number
          folder_name?: string | null
          folders_failed?: number
          folders_ok?: number
          folders_total?: number
          id?: string
          inaccessible_chats?: number
          share_link?: string | null
          share_link_note?: string | null
          stage?: string | null
          status?: string
          total_chats?: number
          unique_chats?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      telegram_config: {
        Row: {
          api_hash_enc: string | null
          api_id_enc: string | null
          bot_token_enc: string | null
          bot_username: string | null
          created_at: string
          is_premium: boolean
          phone: string | null
          session_enc: string | null
          telegram_user_id: number | null
          telegram_username: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          api_hash_enc?: string | null
          api_id_enc?: string | null
          bot_token_enc?: string | null
          bot_username?: string | null
          created_at?: string
          is_premium?: boolean
          phone?: string | null
          session_enc?: string | null
          telegram_user_id?: number | null
          telegram_username?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          api_hash_enc?: string | null
          api_id_enc?: string | null
          bot_token_enc?: string | null
          bot_username?: string | null
          created_at?: string
          is_premium?: boolean
          phone?: string | null
          session_enc?: string | null
          telegram_user_id?: number | null
          telegram_username?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      telegram_status: {
        Row: {
          api_configured: boolean
          bot_configured: boolean
          bot_username: string | null
          is_premium: boolean
          last_error: string | null
          session_configured: boolean
          telegram_username: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          api_configured?: boolean
          bot_configured?: boolean
          bot_username?: string | null
          is_premium?: boolean
          last_error?: string | null
          session_configured?: boolean
          telegram_username?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          api_configured?: boolean
          bot_configured?: boolean
          bot_username?: string | null
          is_premium?: boolean
          last_error?: string | null
          session_configured?: boolean
          telegram_username?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      worker_link: {
        Row: {
          created_at: string
          last_seen_at: string | null
          updated_at: string
          user_id: string
          worker_token: string
          worker_url: string | null
        }
        Insert: {
          created_at?: string
          last_seen_at?: string | null
          updated_at?: string
          user_id: string
          worker_token: string
          worker_url?: string | null
        }
        Update: {
          created_at?: string
          last_seen_at?: string | null
          updated_at?: string
          user_id?: string
          worker_token?: string
          worker_url?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
