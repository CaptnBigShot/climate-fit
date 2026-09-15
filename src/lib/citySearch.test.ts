import { describe, expect, it } from 'vitest'
import { CITIES } from './data'
import { fold, searchCities } from './citySearch'

const ids = (q: string, exclude?: string[]) => searchCities(q, exclude).map((c) => c.id)

describe('city search', () => {
  it('lists every city alphabetically with no query', () => {
    const all = searchCities('')
    expect(all).toHaveLength(CITIES.length)
    expect(all.map((c) => c.name)).toEqual([...all.map((c) => c.name)].sort((a, b) => a.localeCompare(b)))
  })

  it('folds accents, ł and the punctuation people skip', () => {
    expect(fold("Wrocław Zürich St. John's")).toBe('wroclaw zurich st johns')
    const names = (q: string) => searchCities(q).map((c) => c.name)
    expect(names('zurich')).toEqual(['Zürich'])
    expect(names('wroclaw')).toEqual(['Wrocław'])
    expect(names('montreal')).toEqual(['Montréal'])
    expect(names('st johns')).toEqual(["St. John's"])
  })

  it('tells same-named cities apart by code or region', () => {
    expect(ids('portland')).toEqual(expect.arrayContaining(['portland', 'portland-me']))
    expect(ids('portland me')).toEqual(['portland-me'])
    expect(ids('london, ontario')).toEqual(['london-on'])
  })

  it('ranks name-prefix matches ahead of code and region matches', () => {
    const r = searchCities('wa')
    expect(r[0].name.toLowerCase().startsWith('wa')).toBe(true)
    expect(r.map((c) => c.id)).toContain('tacoma') // code WA
    const firstCodeOnly = r.findIndex((c) => !c.name.toLowerCase().split(/\W+/).some((w) => w.startsWith('wa')))
    expect(r.slice(0, firstCodeOnly).every((c) => c.name.toLowerCase().split(/\W+/).some((w) => w.startsWith('wa')))).toBe(true)
  })

  it('matches inside a name from three letters, never on shorter fragments', () => {
    expect(ids('ville')).toEqual(expect.arrayContaining(['asheville']))
    expect(ids('ll').every((id) => {
      const c = CITIES.find((x) => x.id === id)!
      return fold(`${c.name} ${c.code} ${c.region}`).split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith('ll'))
    })).toBe(true)
  })

  it('drops excluded cities and returns nothing for a miss', () => {
    expect(ids('tacoma', ['tacoma'])).toEqual([])
    expect(searchCities('', ['tacoma'])).toHaveLength(CITIES.length - 1)
    expect(ids('atlantis')).toEqual([])
  })
})
