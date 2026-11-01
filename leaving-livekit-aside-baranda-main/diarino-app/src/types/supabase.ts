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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      moderation_settings: {
        Row: { id: boolean; require_reel_approval: boolean; updated_at: string; updated_by: string | null }
        Insert: { id?: boolean; require_reel_approval?: boolean; updated_at?: string; updated_by?: string | null }
        Update: { id?: boolean; require_reel_approval?: boolean; updated_at?: string; updated_by?: string | null }
        Relationships: []
      }
      request_offers: {
        Row: {
          chat_id: string | null
          created_at: string
          id: string
          message: string
          offerer_id: string
          price: number | null
          request_id: string | null
          request_title: string
          requester_id: string
          responded_at: string | null
          status: string
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          chat_id?: string | null
          created_at?: string
          id?: string
          message: string
          offerer_id: string
          price?: number | null
          request_id?: string | null
          request_title?: string
          requester_id: string
          responded_at?: string | null
          status?: string
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          chat_id?: string | null
          created_at?: string
          id?: string
          message?: string
          offerer_id?: string
          price?: number | null
          request_id?: string | null
          request_title?: string
          requester_id?: string
          responded_at?: string | null
          status?: string
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: []
      }
      property_offers: {
        Row: {
          chat_id: string | null
          created_at: string
          id: string
          message: string
          offerer_id: string
          price: number | null
          property_id: string
          responded_at: string | null
          seller_id: string
          status: string
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          chat_id?: string | null
          created_at?: string
          id?: string
          message: string
          offerer_id: string
          price?: number | null
          property_id: string
          responded_at?: string | null
          seller_id: string
          status?: string
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          chat_id?: string | null
          created_at?: string
          id?: string
          message?: string
          offerer_id?: string
          price?: number | null
          property_id?: string
          responded_at?: string | null
          seller_id?: string
          status?: string
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "property_offers_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      reel_comments: {
        Row: {
          body: string
          created_at: string
          id: string
          like_count: number
          owner_liked: boolean
          parent_id: string | null
          pinned_at: string | null
          property_id: string
          reply_count: number
          reply_to_user_id: string | null
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          like_count?: number
          owner_liked?: boolean
          parent_id?: string | null
          pinned_at?: string | null
          property_id: string
          reply_count?: number
          reply_to_user_id?: string | null
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          like_count?: number
          owner_liked?: boolean
          parent_id?: string | null
          pinned_at?: string | null
          property_id?: string
          reply_count?: number
          reply_to_user_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reel_comments_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reel_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "reel_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      reel_comment_likes: {
        Row: { comment_id: string; created_at: string; user_id: string }
        Insert: { comment_id: string; created_at?: string; user_id: string }
        Update: { comment_id?: string; created_at?: string; user_id?: string }
        Relationships: [
          {
            foreignKeyName: "reel_comment_likes_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "reel_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      property_deals: {
        Row: {
          admin_note: string | null
          deal_type: string
          due_at: string | null
          fee_egp: number
          handled_at: string | null
          handled_by: string | null
          id: string
          note: string | null
          paid_at: string | null
          payer_account_type: string | null
          payer_id: string | null
          payer_name: string | null
          payer_phone: string | null
          payer_email: string | null
          payment_method: string | null
          payment_ref: string | null
          payment_sender_name: string | null
          payment_sender_email: string | null
          payment_contact_phone: string | null
          payment_submitted_at: string | null
          property_id: string | null
          property_province: string | null
          property_title: string
          reported_at: string
          status: string
        }
        Insert: {
          admin_note?: string | null
          deal_type: string
          due_at?: string | null
          fee_egp: number
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          note?: string | null
          paid_at?: string | null
          payer_account_type?: string | null
          payer_id?: string | null
          payer_name?: string | null
          payer_phone?: string | null
          payer_email?: string | null
          payment_method?: string | null
          payment_ref?: string | null
          payment_sender_name?: string | null
          payment_sender_email?: string | null
          payment_contact_phone?: string | null
          payment_submitted_at?: string | null
          property_id?: string | null
          property_province?: string | null
          property_title?: string
          reported_at?: string
          status?: string
        }
        Update: {
          admin_note?: string | null
          deal_type?: string
          due_at?: string | null
          fee_egp?: number
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          note?: string | null
          paid_at?: string | null
          payer_account_type?: string | null
          payer_id?: string | null
          payer_name?: string | null
          payer_phone?: string | null
          payer_email?: string | null
          payment_method?: string | null
          payment_ref?: string | null
          payment_sender_name?: string | null
          payment_sender_email?: string | null
          payment_contact_phone?: string | null
          payment_submitted_at?: string | null
          property_id?: string | null
          property_province?: string | null
          property_title?: string
          reported_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_deals_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_settings: {
        Row: {
          fee_egp: number
          fee_rent_egp: number
          id: boolean
          notify_days: number
          pay_days: number
          payment_instructions: string | null
          protection_days: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          fee_egp?: number
          fee_rent_egp?: number
          id?: boolean
          notify_days?: number
          pay_days?: number
          payment_instructions?: string | null
          protection_days?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          fee_egp?: number
          fee_rent_egp?: number
          id?: boolean
          notify_days?: number
          pay_days?: number
          payment_instructions?: string | null
          protection_days?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      ad_promotions: {
        Row: {
          admin_note: string | null
          age_max: number | null
          age_min: number | null
          created_at: string
          duration_days: number
          ends_at: string | null
          handled_at: string | null
          handled_by: string | null
          id: string
          kind: string
          paid_at: string | null
          payer_email: string | null
          payer_id: string | null
          payer_name: string | null
          payer_phone: string | null
          payment_contact_phone: string | null
          payment_method: string | null
          payment_ref: string | null
          payment_sender_name: string | null
          payment_submitted_at: string | null
          price_egp: number
          property_id: string | null
          property_title: string
          reach_goal: number | null
          sponsored_reel_id: string | null
          starts_at: string | null
          status: string
        }
        Insert: {
          admin_note?: string | null
          age_max?: number | null
          age_min?: number | null
          created_at?: string
          duration_days?: number
          ends_at?: string | null
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          kind?: string
          paid_at?: string | null
          payer_email?: string | null
          payer_id?: string | null
          payer_name?: string | null
          payer_phone?: string | null
          payment_contact_phone?: string | null
          payment_method?: string | null
          payment_ref?: string | null
          payment_sender_name?: string | null
          payment_submitted_at?: string | null
          price_egp?: number
          property_id?: string | null
          property_title?: string
          reach_goal?: number | null
          sponsored_reel_id?: string | null
          starts_at?: string | null
          status?: string
        }
        Update: {
          admin_note?: string | null
          age_max?: number | null
          age_min?: number | null
          created_at?: string
          duration_days?: number
          ends_at?: string | null
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          kind?: string
          paid_at?: string | null
          payer_email?: string | null
          payer_id?: string | null
          payer_name?: string | null
          payer_phone?: string | null
          payment_contact_phone?: string | null
          payment_method?: string | null
          payment_ref?: string | null
          payment_sender_name?: string | null
          payment_submitted_at?: string | null
          price_egp?: number
          property_id?: string | null
          property_title?: string
          reach_goal?: number | null
          sponsored_reel_id?: string | null
          starts_at?: string | null
          status?: string
        }
        Relationships: []
      }
      promo_settings: {
        Row: {
          banner_price_14_egp: number
          banner_price_30_egp: number
          banner_price_7_egp: number
          duration_days: number
          featured_price_egp: number
          id: boolean
          intro_price_3000_egp: number
          intro_price_5000_egp: number
          updated_at: string
        }
        Insert: {
          banner_price_14_egp?: number
          banner_price_30_egp?: number
          banner_price_7_egp?: number
          duration_days?: number
          featured_price_egp?: number
          id?: boolean
          intro_price_3000_egp?: number
          intro_price_5000_egp?: number
          updated_at?: string
        }
        Update: {
          banner_price_14_egp?: number
          banner_price_30_egp?: number
          banner_price_7_egp?: number
          duration_days?: number
          featured_price_egp?: number
          id?: boolean
          intro_price_3000_egp?: number
          intro_price_5000_egp?: number
          updated_at?: string
        }
        Relationships: []
      }
      ad_space_orders: {
        Row: {
          admin_note: string | null
          banner_id: string | null
          created_at: string
          duration_days: number
          ends_at: string | null
          handled_at: string | null
          handled_by: string | null
          id: string
          image_url: string
          paid_at: string | null
          payer_email: string | null
          payer_id: string | null
          payer_name: string | null
          payer_phone: string | null
          payment_contact_phone: string | null
          payment_method: string | null
          payment_ref: string | null
          payment_sender_name: string | null
          payment_submitted_at: string | null
          price_egp: number
          starts_at: string | null
          status: string
          title: string
        }
        Insert: {
          admin_note?: string | null
          banner_id?: string | null
          created_at?: string
          duration_days?: number
          ends_at?: string | null
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          image_url?: string
          paid_at?: string | null
          payer_email?: string | null
          payer_id?: string | null
          payer_name?: string | null
          payer_phone?: string | null
          payment_contact_phone?: string | null
          payment_method?: string | null
          payment_ref?: string | null
          payment_sender_name?: string | null
          payment_submitted_at?: string | null
          price_egp?: number
          starts_at?: string | null
          status?: string
          title?: string
        }
        Update: {
          admin_note?: string | null
          banner_id?: string | null
          created_at?: string
          duration_days?: number
          ends_at?: string | null
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          image_url?: string
          paid_at?: string | null
          payer_email?: string | null
          payer_id?: string | null
          payer_name?: string | null
          payer_phone?: string | null
          payment_contact_phone?: string | null
          payment_method?: string | null
          payment_ref?: string | null
          payment_sender_name?: string | null
          payment_submitted_at?: string | null
          price_egp?: number
          starts_at?: string | null
          status?: string
          title?: string
        }
        Relationships: []
      }
      music_tracks: {
        Row: {
          active: boolean
          builtin_key: string | null
          created_at: string
          description: string | null
          duration_sec: number | null
          id: string
          license_note: string | null
          public_id: string | null
          sort_order: number
          title: string
          url: string | null
        }
        Insert: {
          active?: boolean
          builtin_key?: string | null
          created_at?: string
          description?: string | null
          duration_sec?: number | null
          id?: string
          license_note?: string | null
          public_id?: string | null
          sort_order?: number
          title: string
          url?: string | null
        }
        Update: {
          active?: boolean
          builtin_key?: string | null
          created_at?: string
          description?: string | null
          duration_sec?: number | null
          id?: string
          license_note?: string | null
          public_id?: string | null
          sort_order?: number
          title?: string
          url?: string | null
        }
        Relationships: []
      }
      known_provinces: {
        Row: {
          created_at: string
          id: string
          name: string
          search_count: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          search_count?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          search_count?: number
        }
        Relationships: []
      }
      ad_banners: {
        Row: {
          active: boolean
          created_at: string
          end_date: string | null
          id: string
          image_url: string | null
          link_url: string | null
          sort_order: number
          start_date: string
          title: string
          whatsapp_message: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          end_date?: string | null
          id?: string
          image_url?: string | null
          link_url?: string | null
          sort_order?: number
          start_date?: string
          title: string
          whatsapp_message?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          end_date?: string | null
          id?: string
          image_url?: string | null
          link_url?: string | null
          sort_order?: number
          start_date?: string
          title?: string
          whatsapp_message?: string | null
        }
        Relationships: []
      }
      ad_carousel_settings: {
        Row: {
          duration_ms: number
          id: boolean
          rotation_mode: string
          show_placeholder: boolean
        }
        Insert: {
          duration_ms?: number
          id?: boolean
          rotation_mode?: string
          show_placeholder?: boolean
        }
        Update: {
          duration_ms?: number
          id?: boolean
          rotation_mode?: string
          show_placeholder?: boolean
        }
        Relationships: []
      }
      ad_contacts: {
        Row: {
          banner_id: string
          banner_title: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          banner_id: string
          banner_title: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          banner_id?: string
          banner_title?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_contacts_banner_id_fkey"
            columns: ["banner_id"]
            isOneToOne: false
            referencedRelation: "ad_banners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_contacts_profile_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_contacts_profile_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      account_deletion_requests: {
        Row: {
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          id: string
          requested_at: string
          status: string
          user_email: string | null
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          requested_at?: string
          status?: string
          user_email?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          requested_at?: string
          status?: string
          user_email?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: []
      }
      admin_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string | null
          after: Json | null
          before: Json | null
          created_at: string
          id: string
          target_id: string | null
          target_table: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          target_id?: string | null
          target_table: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          target_id?: string | null
          target_table?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          chat_id: string
          created_at: string
          id: string
          images: string[]
          read: boolean
          sender_id: string
          text: string
          whatsapp: string | null
        }
        Insert: {
          chat_id: string
          created_at?: string
          id?: string
          images?: string[]
          read?: boolean
          sender_id: string
          text?: string
          whatsapp?: string | null
        }
        Update: {
          chat_id?: string
          created_at?: string
          id?: string
          images?: string[]
          read?: boolean
          sender_id?: string
          text?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
        ]
      }
      chats: {
        Row: {
          created_at: string
          id: string
          initiator_id: string
          partner_id: string
          property_id: string | null
          request_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          initiator_id: string
          partner_id: string
          property_id?: string | null
          request_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          initiator_id?: string
          partner_id?: string
          property_id?: string | null
          request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chats_initiator_profile_fkey"
            columns: ["initiator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chats_initiator_profile_fkey"
            columns: ["initiator_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chats_partner_profile_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chats_partner_profile_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chats_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chats_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      drafts: {
        Row: {
          data: Json
          draft_type: string
          id: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          data: Json
          draft_type: string
          id?: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          data?: Json
          draft_type?: string
          id?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "drafts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drafts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      favorites: {
        Row: {
          created_at: string
          id: string
          property_id: string | null
          request_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          property_id?: string | null
          request_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          property_id?: string | null
          request_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          description: string
          enabled: boolean
          key: string
          name: string
          updated_at: string
        }
        Insert: {
          description: string
          enabled?: boolean
          key: string
          name: string
          updated_at?: string
        }
        Update: {
          description?: string
          enabled?: boolean
          key?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      seller_notification_subscriptions: {
        Row: {
          created_at: string
          seller_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          seller_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          seller_id?: string
          user_id?: string
        }
        Relationships: []
      }
      follows: {
        Row: {
          created_at: string
          followee_id: string
          follower_id: string
          id: string
          notify: boolean
        }
        Insert: {
          created_at?: string
          followee_id: string
          follower_id: string
          id?: string
          notify?: boolean
        }
        Update: {
          created_at?: string
          followee_id?: string
          follower_id?: string
          id?: string
          notify?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "follows_followee_id_fkey"
            columns: ["followee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follows_followee_id_fkey"
            columns: ["followee_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follows_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follows_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      known_regions: {
        Row: {
          created_at: string
          id: string
          name: string
          province: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          province: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          province?: string
        }
        Relationships: []
      }
      likes: {
        Row: {
          created_at: string
          id: string
          property_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          property_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          property_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "likes_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      live_message_rate_buckets: {
        Row: {
          bucket_second: number
          count: number
          message_type: string
          room_name: string
          user_id: string
        }
        Insert: {
          bucket_second: number
          count?: number
          message_type: string
          room_name: string
          user_id: string
        }
        Update: {
          bucket_second?: number
          count?: number
          message_type?: string
          room_name?: string
          user_id?: string
        }
        Relationships: []
      }
      lives: {
        Row: {
          rights_declared_at: string | null
          comments_hidden: boolean
          created_at: string
          duration_sec: number | null
          egress_id: string | null
          ended_at: string | null
          host_id: string
          id: string
          moderation_status: string
          pinned: boolean
          pinned_at: string | null
          poster_url: string | null
          published_public: boolean
          recording_filepath: string | null
          recording_status: string
          recording_url: string | null
          room_name: string
          status: string
          title: string | null
          viewer_peak: number
        }
        Insert: {
          rights_declared_at?: string | null
          comments_hidden?: boolean
          created_at?: string
          duration_sec?: number | null
          egress_id?: string | null
          ended_at?: string | null
          host_id: string
          id?: string
          moderation_status?: string
          pinned?: boolean
          pinned_at?: string | null
          poster_url?: string | null
          published_public?: boolean
          recording_filepath?: string | null
          recording_status?: string
          recording_url?: string | null
          room_name: string
          status?: string
          title?: string | null
          viewer_peak?: number
        }
        Update: {
          rights_declared_at?: string | null
          comments_hidden?: boolean
          created_at?: string
          duration_sec?: number | null
          egress_id?: string | null
          ended_at?: string | null
          host_id?: string
          id?: string
          moderation_status?: string
          pinned?: boolean
          pinned_at?: string | null
          poster_url?: string | null
          published_public?: boolean
          recording_filepath?: string | null
          recording_status?: string
          recording_url?: string | null
          room_name?: string
          status?: string
          title?: string | null
          viewer_peak?: number
        }
        Relationships: [
          {
            foreignKeyName: "lives_host_profile_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lives_host_profile_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      media: {
        Row: {
          bytes: number | null
          context: string
          context_id: string | null
          created_at: string
          duration: number | null
          format: string | null
          height: number | null
          id: string
          owner_id: string
          public_id: string
          thumbnail_url: string | null
          type: string
          url: string
          width: number | null
        }
        Insert: {
          bytes?: number | null
          context?: string
          context_id?: string | null
          created_at?: string
          duration?: number | null
          format?: string | null
          height?: number | null
          id?: string
          owner_id: string
          public_id: string
          thumbnail_url?: string | null
          type: string
          url: string
          width?: number | null
        }
        Update: {
          bytes?: number | null
          context?: string
          context_id?: string | null
          created_at?: string
          duration?: number | null
          format?: string | null
          height?: number | null
          id?: string
          owner_id?: string
          public_id?: string
          thumbnail_url?: string | null
          type?: string
          url?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "media_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_items: {
        Row: {
          action_type: string
          action_value: string
          active: boolean
          badge_label: string | null
          color: string
          color_end: string | null
          created_at: string
          cta_label: string | null
          font_bold: boolean
          font_color: string | null
          font_size: number | null
          font_style: string
          icon_key: string
          image_fit: string
          image_pad_h: number | null
          image_pad_v: number | null
          image_side: string
          image_size: string
          image_url: string | null
          id: string
          size: string
          sort_order: number
          subtitle: string | null
          text_halign: string
          text_layout: string
          text_valign: string
          title: string
        }
        Insert: {
          action_type: string
          action_value: string
          active?: boolean
          badge_label?: string | null
          color?: string
          color_end?: string | null
          created_at?: string
          cta_label?: string | null
          font_bold?: boolean
          font_color?: string | null
          font_size?: number | null
          font_style?: string
          icon_key?: string
          image_fit?: string
          image_pad_h?: number | null
          image_pad_v?: number | null
          image_side?: string
          image_size?: string
          image_url?: string | null
          id?: string
          size?: string
          sort_order?: number
          subtitle?: string | null
          text_halign?: string
          text_layout?: string
          text_valign?: string
          title: string
        }
        Update: {
          action_type?: string
          action_value?: string
          active?: boolean
          badge_label?: string | null
          color?: string
          color_end?: string | null
          created_at?: string
          cta_label?: string | null
          font_bold?: boolean
          font_color?: string | null
          font_size?: number | null
          font_style?: string
          icon_key?: string
          image_fit?: string
          image_pad_h?: number | null
          image_pad_v?: number | null
          image_side?: string
          image_size?: string
          image_url?: string | null
          id?: string
          size?: string
          sort_order?: number
          subtitle?: string | null
          text_halign?: string
          text_layout?: string
          text_valign?: string
          title?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          actor_id: string | null
          category: string
          chat_id: string | null
          created_at: string
          id: string
          property_id: string | null
          read: boolean
          recipient_id: string
          text: string
        }
        Insert: {
          actor_id?: string | null
          category: string
          chat_id?: string | null
          created_at?: string
          id?: string
          property_id?: string | null
          read?: boolean
          recipient_id: string
          text: string
        }
        Update: {
          actor_id?: string | null
          category?: string
          chat_id?: string | null
          created_at?: string
          id?: string
          property_id?: string | null
          read?: boolean
          recipient_id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_actor_profile_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_actor_profile_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          chat_on_properties: boolean
          chat_on_requests: boolean
          created_at: string
          full_name: string | null
          id: string
          is_public: boolean
          notify_chat: boolean
          notify_follows: boolean
          notify_likes: boolean
          notify_saves: boolean
          phone: string | null
          phone_country_code: string | null
          phone_country_name: string | null
          phone_e164: string | null
          phone_verified: boolean
          show_call_button: boolean
          show_whatsapp: boolean
          verified: boolean
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          chat_on_properties?: boolean
          chat_on_requests?: boolean
          created_at?: string
          full_name?: string | null
          id: string
          is_public?: boolean
          notify_chat?: boolean
          notify_follows?: boolean
          notify_likes?: boolean
          notify_saves?: boolean
          phone?: string | null
          phone_country_code?: string | null
          phone_country_name?: string | null
          phone_e164?: string | null
          phone_verified?: boolean
          show_call_button?: boolean
          show_whatsapp?: boolean
          verified?: boolean
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          chat_on_properties?: boolean
          chat_on_requests?: boolean
          created_at?: string
          full_name?: string | null
          id?: string
          is_public?: boolean
          notify_chat?: boolean
          notify_follows?: boolean
          notify_likes?: boolean
          notify_saves?: boolean
          phone?: string | null
          phone_country_code?: string | null
          phone_country_name?: string | null
          phone_e164?: string | null
          phone_verified?: boolean
          show_call_button?: boolean
          show_whatsapp?: boolean
          verified?: boolean
        }
        Relationships: []
      }
      properties: {
        Row: {
          area: number
          baths: number
          chats: number
          cover_image: string | null
          created_at: string
          delivery_date: string | null
          description: string
          features: string[]
          finish_type: string | null
          floor: number | null
          id: string
          lat: number | null
          likes: number
          lng: number | null
          location: string
          media: Json
          moderation_status: string
          music: string | null
          closed_at: string | null
          closed_type: string | null
          rights_declared_at: string | null
          comment_count: number
          moderated_at: string | null
          published_at: string | null
          moderated_by: string | null
          moderation_reason: string | null
          negotiable: boolean | null
          payment: string | null
          pinned: boolean
          pinned_at: string | null
          price: number
          province: string
          purpose: string
          reception: number
          rooms: number
          saves: number
          seller_id: string
          share_platforms: string[]
          short_title: string | null
          status: string | null
          title: string
          type: string
          updated_at: string
          views: number
          wa_clicks: number
        }
        Insert: {
          area: number
          baths?: number
          chats?: number
          cover_image?: string | null
          created_at?: string
          delivery_date?: string | null
          description?: string
          features?: string[]
          finish_type?: string | null
          floor?: number | null
          id?: string
          lat?: number | null
          likes?: number
          lng?: number | null
          location: string
          media?: Json
          moderation_status?: string
          music?: string | null
          closed_at?: string | null
          closed_type?: string | null
          rights_declared_at?: string | null
          comment_count?: number
          moderated_at?: string | null
          published_at?: string | null
          moderated_by?: string | null
          moderation_reason?: string | null
          negotiable?: boolean | null
          payment?: string | null
          pinned?: boolean
          pinned_at?: string | null
          price: number
          province: string
          purpose: string
          reception?: number
          rooms?: number
          saves?: number
          seller_id: string
          share_platforms?: string[]
          short_title?: string | null
          status?: string | null
          title: string
          type: string
          updated_at?: string
          views?: number
          wa_clicks?: number
        }
        Update: {
          area?: number
          baths?: number
          chats?: number
          cover_image?: string | null
          created_at?: string
          delivery_date?: string | null
          description?: string
          features?: string[]
          finish_type?: string | null
          floor?: number | null
          id?: string
          lat?: number | null
          likes?: number
          lng?: number | null
          location?: string
          media?: Json
          moderation_status?: string
          music?: string | null
          closed_at?: string | null
          closed_type?: string | null
          rights_declared_at?: string | null
          comment_count?: number
          moderated_at?: string | null
          published_at?: string | null
          moderated_by?: string | null
          moderation_reason?: string | null
          negotiable?: boolean | null
          payment?: string | null
          pinned?: boolean
          pinned_at?: string | null
          price?: number
          province?: string
          purpose?: string
          reception?: number
          rooms?: number
          saves?: number
          seller_id?: string
          share_platforms?: string[]
          short_title?: string | null
          status?: string | null
          title?: string
          type?: string
          updated_at?: string
          views?: number
          wa_clicks?: number
        }
        Relationships: [
          {
            foreignKeyName: "properties_seller_profile_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "properties_seller_profile_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      push_tokens: {
        Row: {
          device_type: string | null
          id: string
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          device_type?: string | null
          id?: string
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          device_type?: string | null
          id?: string
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          admin_reply: string | null
          replied_at: string | null
          replied_by: string | null
          created_at: string
          id: string
          reason: string
          reporter_id: string
          target_color: string
          target_id: string
          target_title: string
          target_type: string
        }
        Insert: {
          admin_reply?: string | null
          replied_at?: string | null
          replied_by?: string | null
          created_at?: string
          id?: string
          reason: string
          reporter_id: string
          target_color?: string
          target_id: string
          target_title: string
          target_type: string
        }
        Update: {
          admin_reply?: string | null
          replied_at?: string | null
          replied_by?: string | null
          created_at?: string
          id?: string
          reason?: string
          reporter_id?: string
          target_color?: string
          target_id?: string
          target_title?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_reporter_profile_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reporter_profile_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      requests: {
        Row: {
          area: string | null
          baths: string | null
          created_at: string
          description: string
          id: string
          location: string
          offers_count: number
          price_max: number | null
          province: string
          purpose: string
          requester_id: string
          requester_name: string
          rooms: string | null
          type: string
        }
        Insert: {
          area?: string | null
          baths?: string | null
          created_at?: string
          description?: string
          id?: string
          location: string
          offers_count?: number
          price_max?: number | null
          province: string
          purpose: string
          requester_id: string
          requester_name: string
          rooms?: string | null
          type: string
        }
        Update: {
          area?: string | null
          baths?: string | null
          created_at?: string
          description?: string
          id?: string
          location?: string
          offers_count?: number
          price_max?: number | null
          province?: string
          purpose?: string
          requester_id?: string
          requester_name?: string
          rooms?: string | null
          type?: string
        }
        Relationships: []
      }
      saved_search_alerts: {
        Row: {
          active: boolean
          created_at: string
          finish_type: string | null
          id: string
          price_max: number | null
          province: string | null
          type: string | null
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          finish_type?: string | null
          id?: string
          price_max?: number | null
          province?: string | null
          type?: string | null
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          finish_type?: string | null
          id?: string
          price_max?: number | null
          province?: string | null
          type?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_search_alerts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_search_alerts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      social_share_links: {
        Row: {
          platform: string
          updated_at: string
          url: string
        }
        Insert: {
          platform: string
          updated_at?: string
          url?: string
        }
        Update: {
          platform?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      sponsored_reels: {
        Row: {
          active: boolean
          age_max: number | null
          age_min: number | null
          created_at: string
          current_reach: number
          end_date: string | null
          gender_target: string | null
          id: string
          placement: string
          property_id: string
          reach_goal: number | null
          start_date: string
        }
        Insert: {
          active?: boolean
          age_max?: number | null
          age_min?: number | null
          created_at?: string
          current_reach?: number
          end_date?: string | null
          gender_target?: string | null
          id?: string
          placement: string
          property_id: string
          reach_goal?: number | null
          start_date?: string
        }
        Update: {
          active?: boolean
          age_max?: number | null
          age_min?: number | null
          created_at?: string
          current_reach?: number
          end_date?: string | null
          gender_target?: string | null
          id?: string
          placement?: string
          property_id?: string
          reach_goal?: number | null
          start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "sponsored_reels_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      suggestions: {
        Row: {
          admin_reply: string | null
          replied_at: string | null
          replied_by: string | null
          created_at: string
          id: string
          text: string
          user_id: string
        }
        Insert: {
          admin_reply?: string | null
          replied_at?: string | null
          replied_by?: string | null
          created_at?: string
          id?: string
          text: string
          user_id: string
        }
        Update: {
          admin_reply?: string | null
          replied_at?: string | null
          replied_by?: string | null
          created_at?: string
          id?: string
          text?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "suggestions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suggestions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      support_messages: {
        Row: {
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_profile_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_messages_profile_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      user_activity_log: {
        Row: {
          activity_type: string
          created_at: string
          details: Json | null
          id: string
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          activity_type: string
          created_at?: string
          details?: Json | null
          id?: string
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          activity_type?: string
          created_at?: string
          details?: Json | null
          id?: string
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_activity_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_activity_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      user_permissions: {
        Row: {
          active: boolean
          direct_wa: boolean
          live: boolean
          paid_ads: boolean
          publish_reels: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          direct_wa?: boolean
          live?: boolean
          paid_ads?: boolean
          publish_reels?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          direct_wa?: boolean
          live?: boolean
          paid_ads?: boolean
          publish_reels?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_permissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_permissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          full_access: boolean
          id: string
          is_super_admin: boolean
          permissions: string[]
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          full_access?: boolean
          id?: string
          is_super_admin?: boolean
          permissions?: string[]
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          full_access?: boolean
          id?: string
          is_super_admin?: boolean
          permissions?: string[]
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_profile_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_user_id_profile_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      profiles_public: {
        Row: {
          avatar_url: string | null
          chat_on_properties: boolean | null
          chat_on_requests: boolean | null
          full_name: string | null
          id: string | null
          is_public: boolean | null
          show_call_button: boolean | null
          show_whatsapp: boolean | null
          verified: boolean | null
        }
        Insert: {
          avatar_url?: string | null
          chat_on_properties?: boolean | null
          chat_on_requests?: boolean | null
          full_name?: string | null
          id?: string | null
          is_public?: boolean | null
          show_call_button?: boolean | null
          show_whatsapp?: boolean | null
          verified?: boolean | null
        }
        Update: {
          avatar_url?: string | null
          chat_on_properties?: boolean | null
          chat_on_requests?: boolean | null
          full_name?: string | null
          id?: string | null
          is_public?: boolean | null
          show_call_button?: boolean | null
          show_whatsapp?: boolean | null
          verified?: boolean | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_has_permission: { Args: { section: string }; Returns: boolean }
      admin_list_users: { Args: never; Returns: Json }
      delete_my_account: { Args: never; Returns: undefined }
      admin_reply_to_report: { Args: { p_report_id: string; p_text: string }; Returns: number }
      admin_reply_to_suggestion: { Args: { p_suggestion_id: string; p_text: string }; Returns: undefined }
      admin_pending_counts: { Args: never; Returns: { reels_pending: number; support_pending: number; deals_pending: number }[] }
      increment_property_views: { Args: { p_property_id: string }; Returns: undefined }
      request_admin_account_deletion: { Args: never; Returns: string }
      cancel_admin_account_deletion_request: { Args: never; Returns: undefined }
      admin_approve_account_deletion: { Args: { p_request_id: string }; Returns: undefined }
      admin_reject_account_deletion: { Args: { p_request_id: string; p_note?: string | null }; Returns: undefined }
      admin_delete_reel: { Args: { p_property_id: string; p_reason?: string }; Returns: undefined }
      admin_delete_request: { Args: { p_request_id: string; p_reason?: string }; Returns: undefined }
      submit_property_offer: {
        Args: { p_message: string; p_price?: number; p_property_id: string; p_whatsapp?: string }
        Returns: Database["public"]["Tables"]["property_offers"]["Row"]
      }
      respond_property_offer: { Args: { p_offer_id: string; p_status: string }; Returns: undefined }
      submit_request_offer: {
        Args: { p_message: string; p_price?: number; p_request_id: string; p_whatsapp?: string }
        Returns: Database["public"]["Tables"]["request_offers"]["Row"]
      }
      respond_request_offer: { Args: { p_offer_id: string; p_status: string }; Returns: undefined }
      admin_list_offers: {
        Args: never
        Returns: {
          id: string
          kind: string
          target_id: string | null
          target_title: string
          asking_price: number | null
          offer_price: number | null
          status: string
          message: string
          offerer_id: string
          offerer_name: string | null
          offerer_phone: string | null
          offerer_email: string | null
          other_id: string
          other_name: string | null
          other_phone: string | null
          other_email: string | null
          chat_id: string | null
          messages_count: number
          created_at: string
          updated_at: string
        }[]
      }
      pin_reel_comment: { Args: { p_comment_id: string; p_pinned: boolean }; Returns: undefined }
      mark_notification_read: { Args: { p_id: string }; Returns: undefined }
      report_property_deal: {
        Args: { p_deal_type: string; p_note?: string; p_property_id: string }
        Returns: Database["public"]["Tables"]["property_deals"]["Row"]
      }
      admin_list_deals: {
        Args: never
        Returns: {
          id: string
          property_id: string | null
          property_title: string
          property_province: string | null
          deal_type: string
          fee_egp: number
          status: string
          reported_at: string
          due_at: string | null
          paid_at: string | null
          payment_ref: string | null
          note: string | null
          admin_note: string | null
          payer_id: string | null
          payer_name: string | null
          payer_phone: string | null
          payer_email: string | null
          payer_account_type: string | null
          payment_sender_name: string | null
          payment_sender_email: string | null
          payment_contact_phone: string | null
          payment_submitted_at: string | null
          payment_method: string | null
        }[]
      }
      confirm_deal_payment: {
        Args: { p_contact_phone: string; p_deal_id: string; p_method: string; p_sender_name: string }
        Returns: Database["public"]["Tables"]["property_deals"]["Row"]
      }
      create_ad_promotion: {
        Args: { p_age_max?: number; p_age_min?: number; p_kind: string; p_property_id: string; p_reach_goal?: number }
        Returns: Database["public"]["Tables"]["ad_promotions"]["Row"]
      }
      confirm_promotion_payment: {
        Args: { p_contact_phone: string; p_id: string; p_method: string; p_sender_name: string }
        Returns: Database["public"]["Tables"]["ad_promotions"]["Row"]
      }
      cancel_ad_promotion: { Args: { p_id: string }; Returns: undefined }
      admin_set_admin_role: {
        Args: { p_full_access?: boolean; p_make_admin: boolean; p_permissions?: string[]; p_user_id: string }
        Returns: undefined
      }
      create_ad_space_order: {
        Args: { p_duration_days: number; p_image_url: string; p_title?: string }
        Returns: Database["public"]["Tables"]["ad_space_orders"]["Row"]
      }
      confirm_ad_space_payment: {
        Args: { p_contact_phone: string; p_id: string; p_method: string; p_sender_name: string }
        Returns: Database["public"]["Tables"]["ad_space_orders"]["Row"]
      }
      cancel_ad_space_order: { Args: { p_id: string }; Returns: undefined }
      admin_update_ad_space_order: {
        Args: { p_admin_note?: string; p_id: string; p_payment_ref?: string; p_status: string }
        Returns: undefined
      }
      admin_list_ad_space_orders: {
        Args: never
        Returns: {
          id: string; title: string; image_url: string; duration_days: number; price_egp: number; status: string
          payment_method: string | null; payment_sender_name: string | null; payment_contact_phone: string | null
          payment_submitted_at: string | null; payment_ref: string | null; admin_note: string | null
          paid_at: string | null; starts_at: string | null; ends_at: string | null; created_at: string
          payer_id: string | null; payer_name: string | null; payer_phone: string | null; payer_email: string | null
        }[]
      }
      admin_update_promotion: {
        Args: { p_admin_note?: string; p_id: string; p_payment_ref?: string; p_status: string }
        Returns: undefined
      }
      admin_list_promotions: {
        Args: never
        Returns: {
          id: string; property_id: string | null; property_title: string; kind: string; reach_goal: number | null
          age_min: number | null; age_max: number | null; duration_days: number; price_egp: number; status: string
          payment_method: string | null; payment_sender_name: string | null; payment_contact_phone: string | null
          payment_submitted_at: string | null; payment_ref: string | null; admin_note: string | null
          paid_at: string | null; starts_at: string | null; ends_at: string | null; created_at: string
          payer_id: string | null; payer_name: string | null; payer_phone: string | null; payer_email: string | null
          current_reach: number
        }[]
      }
      submit_deal_payment: {
        Args: { p_contact_phone: string; p_deal_id: string; p_sender_email: string; p_sender_name: string }
        Returns: Database["public"]["Tables"]["property_deals"]["Row"]
      }
      admin_update_deal: {
        Args: {
          p_admin_note?: string
          p_id: string
          p_payment_ref?: string
          p_reopen?: boolean
          p_status: string
        }
        Returns: undefined
      }
      bump_live_message_rate: {
        Args: {
          p_limit: number
          p_message_type: string
          p_room_name: string
          p_user_id: string
        }
        Returns: boolean
      }
      cleanup_old_rate_buckets: { Args: never; Returns: undefined }
      earth: { Args: never; Returns: number }
      get_property_contact_phone: {
        Args: { p_property_id: string }
        Returns: string
      }
      record_province_search_attempt: {
        Args: { p_name: string }
        Returns: number
      }
      increment_request_offers: {
        Args: { request_id: string }
        Returns: undefined
      }
      increment_sponsored_reach: {
        Args: { sponsored_id: string }
        Returns: undefined
      }
      increment_wa_clicks: { Args: { property_id: string }; Returns: undefined }
      is_admin: { Args: never; Returns: boolean }
      mark_chat_messages_read: {
        Args: { p_chat_id: string }
        Returns: undefined
      }
      mark_notifications_read: {
        Args: { p_categories: string[] }
        Returns: undefined
      }
      properties_in_bounds: {
        Args: {
          max_lat: number
          max_lng: number
          min_lat: number
          min_lng: number
          p_limit?: number
          p_purpose?: string
          p_type?: string
        }
        Returns: {
          id: string
        }[]
      }
      properties_in_radius: {
        Args: {
          center_lat: number
          center_lng: number
          p_area_max?: number
          p_area_min?: number
          p_limit?: number
          p_min_rooms?: number
          p_offset?: number
          p_price_max?: number
          p_price_min?: number
          p_provinces?: string[]
          p_purpose?: string
          p_query?: string
          p_regions?: string[]
          p_type?: string
          radius_km: number
        }
        Returns: {
          id: string
        }[]
      }
      reassign_push_token: {
        Args: { p_device_type: string; p_token: string }
        Returns: undefined
      }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
