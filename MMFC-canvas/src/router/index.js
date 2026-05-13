/**
 * Router configuration | 路由配置
 */
import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'Home',
    component: () => import('../views/Home.vue')
  },
  {
    // 内部路由用 /edit/，避免与 base '/canvas/' 拼接成 /canvas/canvas/...
    path: '/edit/:id?',
    name: 'Canvas',
    component: () => import('../views/Canvas.vue')
  }
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
})

router.afterEach((to) => {
  if (typeof window === 'undefined' || window.parent === window) return
  const projectId = to.name === 'Canvas' && typeof to.params.id === 'string' ? to.params.id : null
  window.parent.postMessage(
    {
      type: 'creator-mmfc:canvas:route',
      projectId
    },
    window.location.origin
  )
})

export default router
