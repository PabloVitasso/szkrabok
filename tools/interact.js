import * as pool from '../core/pool.js'
import * as upstream from '../upstream/wrapper.js'

export const click = async args => {
    const { id, selector } = args
    const session = pool.get(id)
    await upstream.click(session.page, selector)
    return { success: true, selector }
}

export const type = async args => {
    const { id, selector, text } = args
    const session = pool.get(id)
    await upstream.type(session.page, selector, text)
    return { success: true, selector }
}

export const select = async args => {
    const { id, selector, value } = args
    const session = pool.get(id)
    await upstream.select(session.page, selector, value)
    return { success: true, selector, value }
}