# B-ENERGY CRM – V2

This is the **staging (V2) version** of the CRM application.

## Environment

* Production: separate Vercel + Supabase project
* V2 (this project): isolated environment for design and feature development
* Database: separate Supabase instance (no production data dependency)

---

## Design System

### Liquid Milky Glass

The application uses a consistent design system called **Liquid Milky Glass**.

Definition:

* Soft, semi-transparent “liquid glass” surfaces
* Not fully transparent, not solid — milky layered material
* White background with opacity ~0.65–0.82
* Noticeable backdrop blur (not extreme)
* Subtle vertical gradient (white → light gray/white)
* Soft top highlight or thin light edge
* Very subtle borders (light, slightly white)
* Diffused, soft shadows (no harsh edges)
* Large border radius (24–32px)
* Dark text on light surface
* Overall feel: calm, premium, airy, Apple-inspired

### Rules

* Avoid hard edges and strong contrast
* Avoid flat solid panels
* Avoid overly glossy or reflective glass
* Prefer soft, layered, luminous UI

Apply this consistently across:

* cards
* tables
* modals
* inputs
* headers

---

## Development Rules

* Work on branch: `v2-staging`
* Do not modify production logic directly
* All UI changes should follow the Liquid Milky Glass design system
* Prefer reusable components over one-off styles

---

## Goal

Create a **clean, modern, premium CRM interface** with consistent visual language and improved UX.
